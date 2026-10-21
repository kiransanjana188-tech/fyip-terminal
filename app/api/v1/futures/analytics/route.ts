import { handler, ok } from "@/lib/api/respond";
import { loadFuturesAnalytics } from "@/lib/analytics/futures-profile";
import { requirePermission } from "@/lib/auth/current";
import { archiveDataStatus } from "@/lib/market/orderflow-store";
import { buildQuoteView } from "@/lib/market/quotes";
import { resolveMarketSymbol } from "@/lib/market/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampNumber(raw: string | null, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const GET = handler(async (req: Request) => {
  requirePermission("market.read");
  const params = new URL(req.url).searchParams;
  const symbol = (params.get("symbol") ?? "ES").trim().toUpperCase();
  const hours = clampNumber(params.get("hours"), 24, 1, 72);
  const rowTicks = clampNumber(params.get("rowTicks"), 2, 1, 20);
  const bucketMinutes = clampNumber(params.get("bucketMinutes"), 15, 1, 120);

  const resolved = resolveMarketSymbol(symbol);
  if (!resolved) {
    return ok({
      available: false,
      reason: `Unknown symbol ${symbol}. Use a futures contract like ESZ6 or a continuous alias like ES1!.`,
      symbol,
      contractSymbol: null,
      displayName: null,
      tickSize: null,
      priceScale: null,
      source: "ninjatrader-orderflow-archive",
      dataStatus: "unavailable" as const,
      asOf: null,
      windowHours: hours,
      quote: null,
      vwap: null,
      profile: null,
      surface: null,
      tradeCount: 0,
      firstTradeAt: null,
      lastTradeAt: null,
      warnings: [],
    });
  }

  const instrument = resolved.instrument;
  const quote = buildQuoteView(instrument);
  const analytics = loadFuturesAnalytics({
    instrumentId: instrument.id,
    hours,
    tickSize: quote.tickSize || instrument.tick_size,
    rowTicks,
    bucketMinutes,
  });

  const available = analytics.tradeCount > 0 || quote.last !== null;
  const dataStatus = quote.dataStatus === "unavailable" && analytics.tradeCount > 0
    ? archiveDataStatus(analytics.lastTradeAt)
    : quote.dataStatus;

  const warnings = [...analytics.warnings];
  if (analytics.tradeCount === 0) {
    warnings.push(
      `No trade prints for ${resolved.contractSymbol} in the last ${hours}h. Ensure the NinjaTrader bridge is connected with the trade channel enabled (trades: true).`,
    );
  }
  if (quote.openInterest === null) {
    warnings.push("Open interest is not being published for this contract by the feed.");
  }

  return ok({
    available,
    reason: available ? null : `No data for ${resolved.contractSymbol} yet.`,
    symbol: resolved.requested,
    contractSymbol: resolved.contractSymbol,
    displayName: instrument.display_name,
    tickSize: quote.tickSize,
    priceScale: quote.priceScale,
    source: "ninjatrader-orderflow-archive",
    dataStatus,
    asOf: quote.eventTimestamp ?? analytics.lastTradeAt,
    windowHours: hours,
    quote: {
      last: quote.last,
      bid: quote.bid,
      ask: quote.ask,
      spread: quote.spread,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      prevClose: quote.prevClose,
      volume: quote.volume,
      openInterest: quote.openInterest,
      change: quote.change,
      changePct: quote.changePct,
    },
    vwap: analytics.vwap,
    profile: analytics.profile,
    surface: analytics.surface,
    tradeCount: analytics.tradeCount,
    firstTradeAt: analytics.firstTradeAt,
    lastTradeAt: analytics.lastTradeAt,
    warnings,
  });
});
