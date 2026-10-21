import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll } from "@/lib/db";
import { getInstrument } from "@/lib/market/instruments";
import { quoteHub } from "@/lib/market/hub";
import { drawdown, historicalVar, parametricVar, stdDev, tradeStats } from "@/lib/finance/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PositionRow { account_id: string; instrument_id: string; quantity: number; avg_price: number }
interface TradeRow { realized_pnl: number | null; quantity: number; price: number; instrument_id: string; executed_at: string }

/**
 * Risk analytics computed from positions + the latest quotes, and from the
 * user's recorded trade ledger. Modelled figures (VaR) are explicitly labelled
 * as estimates, never guarantees.
 */
export const GET = handler(async () => {
  const user = requirePermission("portfolio.read");
  const accounts = queryAll<{ id: string }>("SELECT id FROM portfolio_accounts WHERE user_id = ?", user.id);
  if (accounts.length === 0) {
    return ok({
      ready: false,
      reason: "No portfolio accounts. Create one under PORT to enable risk analytics.",
      exposures: [],
      byAssetClass: [],
      concentration: null,
      drawdown: null,
      var: null,
      tradeStats: null,
    });
  }
  const ids = accounts.map((a) => a.id);
  const ph = ids.map(() => "?").join(",");
  const positions = queryAll<PositionRow>(`SELECT * FROM positions WHERE account_id IN (${ph})`, ...ids);
  const trades = queryAll<TradeRow>(`SELECT * FROM trades WHERE account_id IN (${ph}) ORDER BY executed_at ASC`, ...ids);

  const exposures = positions.map((p) => {
    const inst = getInstrument(p.instrument_id);
    const q = inst ? quoteHub.get(inst.id) : undefined;
    const mult = inst?.contract_multiplier ?? 1;
    const value = q?.last != null ? q.last * p.quantity * mult : null;
    return {
      instrumentId: p.instrument_id,
      symbol: inst?.symbol ?? p.instrument_id,
      assetClass: inst?.asset_class ?? "unknown",
      quantity: p.quantity,
      notional: value,
      priceStatus: q?.dataStatus ?? "unavailable",
    };
  });

  const totalNotional = exposures.reduce((a, e) => a + Math.abs(e.notional ?? 0), 0);
  const byAssetClass = Object.entries(
    exposures.reduce<Record<string, number>>((acc, e) => {
      acc[e.assetClass] = (acc[e.assetClass] ?? 0) + Math.abs(e.notional ?? 0);
      return acc;
    }, {}),
  ).map(([assetClass, notional]) => ({ assetClass, notional, weight: totalNotional > 0 ? notional / totalNotional : 0 }));

  const weights = exposures.map((e) => (totalNotional > 0 ? Math.abs(e.notional ?? 0) / totalNotional : 0));
  const hhi = weights.reduce((a, w) => a + w * w, 0);
  const topWeight = weights.length ? Math.max(...weights) : 0;

  // Equity curve from cumulative realised P&L on the trade ledger.
  let cum = 0;
  const equity = trades.map((t) => (cum += t.realized_pnl ?? 0));
  const dd = equity.length > 1 ? drawdown(equity) : null;

  // VaR from the per-trade P&L series, expressed as a fraction of gross notional.
  const pnlSeries = trades.map((t) => t.realized_pnl ?? 0).filter((v) => v !== 0);
  const returns = totalNotional > 0 ? pnlSeries.map((v) => v / totalNotional) : [];
  const histVar = historicalVar(returns, 0.95);
  const paramVar = parametricVar(returns, 0.95);

  return ok({
    ready: true,
    method: {
      var: "VaR on the per-trade realised-P&L series normalised by current gross notional; historical + parametric (normal) methods.",
      correlation: "Unavailable without a bar-history dataset; connect a historical provider.",
      drawdown: "Drawdown of the cumulative realised-P&L equity curve.",
    },
    exposures,
    totalNotional,
    byAssetClass,
    concentration: { hhi, topWeight, positions: exposures.length },
    grossExposure: totalNotional,
    drawdown: dd,
    var: histVar ?? paramVar,
    varBoth: { historical: histVar, parametric: paramVar },
    tradeVolatility: returns.length > 1 ? stdDev(returns) : null,
    tradeStats: tradeStats(pnlSeries),
    correlationMatrix: null,
  });
});