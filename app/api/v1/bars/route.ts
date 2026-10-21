import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { resolveMarketSymbol } from "@/lib/market/resolve";
import { archiveDataStatus, archiveWindow, archivedBars } from "@/lib/market/orderflow-store";
import { syntheticBars, timeframeSeconds, TIMEFRAMES, type BarsResult } from "@/lib/market/bars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bar history for the chart workspace.
 *
 * Primary source: the server-side order-flow archive (real NinjaTrader bridge
 * trade prints aggregated into OHLCV buckets). When that archive is empty and
 * FYIP_ENABLE_FIXTURES=true, deterministic SYNTHETIC bars are returned and
 * flagged `simulated`; otherwise the route reports `unavailable` explicitly.
 */
export const GET = handler(async (req: Request) => {
  requirePermission("market.read");
  const p = new URL(req.url).searchParams;
  const symbol = (p.get("symbol") ?? "ES1!").trim().toUpperCase();
  const timeframe = p.get("timeframe") ?? "5m";
  const count = Math.min(Math.max(Number(p.get("count") ?? 300), 10), 2000);
  const resolved = resolveMarketSymbol(symbol);

  if (!TIMEFRAMES.includes(timeframe)) {
    return ok({ symbol, timeframe, source: "n/a", dataStatus: "unavailable", bars: [], reason: `Unsupported timeframe ${timeframe}` } satisfies BarsResult);
  }

  if (!resolved) {
    return ok({
      symbol,
      timeframe,
      source: "none",
      dataStatus: "unavailable",
      bars: [],
      reason: `Unknown symbol ${symbol}. Use a contract such as ESZ6 or a continuous root such as ES1!.`,
    } satisfies BarsResult);
  }

  const bars = archivedBars(resolved.instrument.id, timeframeSeconds(timeframe), count);
  if (bars.length > 0) {
    const window = archiveWindow(resolved.instrument.id);
    return ok({
      symbol: resolved.requested,
      contractSymbol: resolved.contractSymbol,
      timeframe,
      source: "ninjatrader-orderflow-archive",
      dataStatus: archiveDataStatus(window.lastTradeAt),
      bars: bars.map(({ time, open, high, low, close, volume }) => ({ time, open, high, low, close, volume })),
      reason: `Built from ${window.tradeCount.toLocaleString("en-US")} archived bridge trade prints (${resolved.contractSymbol}).`,
    } satisfies BarsResult);
  }

  if (process.env.FYIP_ENABLE_FIXTURES === "true") {
    return ok({
      symbol: resolved.requested,
      contractSymbol: resolved.contractSymbol,
      timeframe,
      source: "fyip-development-fixture",
      dataStatus: "simulated",
      bars: syntheticBars(resolved.contractSymbol, timeframe, count),
      reason: "SYNTHETIC development bars — not real market history.",
    } satisfies BarsResult);
  }

  return ok({
    symbol: resolved.requested,
    contractSymbol: resolved.contractSymbol,
    timeframe,
    source: "ninjatrader-orderflow-archive",
    dataStatus: "unavailable",
    bars: [],
    reason: `No archived trades for ${resolved.contractSymbol} yet. Bars are built from real bridge trade prints and start when the Add-On or reference bridge connects.`,
  } satisfies BarsResult);
});