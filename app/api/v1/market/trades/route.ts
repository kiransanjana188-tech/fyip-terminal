import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { resolveMarketSymbol } from "@/lib/market/resolve";
import { archiveDataStatus, archiveWindow, archivedTrades } from "@/lib/market/orderflow-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("market.read");
  const params = new URL(req.url).searchParams;
  const symbol = (params.get("symbol") ?? "ESZ6").trim().toUpperCase();
  const limitRaw = Number(params.get("limit") ?? 2000);
  const limit = Number.isFinite(limitRaw) ? Math.min(10_000, Math.max(1, Math.round(limitRaw))) : 2000;
  const from = params.get("from");
  const to = params.get("to");
  const resolved = resolveMarketSymbol(symbol);

  if (!resolved) {
    return fail(404, "SYMBOL_NOT_FOUND", `Unknown symbol ${symbol}.`);
  }

  const stats = archiveWindow(resolved.instrument.id);
  const trades = archivedTrades(resolved.instrument.id, { limit, from, to }).map((trade) => ({
    id: trade.id,
    instrumentId: trade.instrumentId,
    symbol: resolved.requested,
    providerSymbol: trade.providerSymbol,
    provider: trade.provider,
    price: trade.price,
    size: trade.size,
    side: trade.side,
    sideSource: trade.sideSource,
    eventTimestamp: trade.eventTimestamp,
    receivedTimestamp: trade.receivedTimestamp,
    dataStatus: trade.dataStatus,
  }));

  return ok({
    symbol: resolved.requested,
    contractSymbol: resolved.contractSymbol,
    instrumentId: resolved.instrument.id,
    displayName: resolved.instrument.display_name,
    tickSize: resolved.instrument.tick_size,
    priceScale: resolved.instrument.price_scale,
    source: "ninjatrader-orderflow-archive",
    dataStatus: archiveDataStatus(stats.lastTradeAt),
    trades,
    stats: {
      tradeCount: stats.tradeCount,
      firstTradeAt: stats.firstTradeAt,
      lastTradeAt: stats.lastTradeAt,
      returned: trades.length,
    },
  });
});
