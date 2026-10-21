import { timingSafeEqual } from "node:crypto";
import { fail, handler, ok } from "@/lib/api/respond";
import { classifyTradeSide } from "@/lib/orderflow/classify";
import { bridgeToken } from "@/lib/market/bridge-token";
import { quoteHub } from "@/lib/market/hub";
import {
  recordDepthSnapshot,
  recordTradePrints,
  type PendingTradePrint,
} from "@/lib/market/orderflow-store";
import { normalizeBridgeEvent, normalizeDepthEvent, normalizeTradeEvent } from "@/lib/providers/ninjatrader-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_000_000; // 2 MB per request
const MAX_EVENTS_PER_REQUEST = 5_000;

function tokenMatches(provided: string | null): boolean {
  const expected = bridgeToken();
  if (!expected) return false;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function extractToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-fyip-bridge-token");
}

/**
 * Authenticated ingestion endpoint for the NinjaTrader 8 Add-On bridge.
 * Read-only market data only. Never exposes broker credentials or trading
 * controls. Rejects oversized payloads and malformed events.
 */
export const POST = handler(async (req: Request) => {
  if (!bridgeToken()) {
    return fail(503, "BRIDGE_NOT_CONFIGURED", "Bridge ingestion is not configured (FYIP_BRIDGE_TOKEN unset).");
  }
  if (!tokenMatches(extractToken(req))) {
    return fail(401, "BRIDGE_UNAUTHORIZED", "Invalid bridge token.");
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return fail(413, "PAYLOAD_TOO_LARGE", `Payload exceeds ${MAX_BODY_BYTES} bytes.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(400, "MALFORMED_JSON", "Request body is not valid JSON.");
  }

  const events: unknown[] = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { events?: unknown }).events)
      ? ((parsed as { events: unknown[] }).events)
      : [parsed];

  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return fail(413, "TOO_MANY_EVENTS", `At most ${MAX_EVENTS_PER_REQUEST} events per request.`);
  }

  let accepted = 0;
  let rejected = 0;
  let quotes = 0;
  let depthLadders = 0;
  let trades = 0;
  const errors: string[] = [];
  const pendingTrades: PendingTradePrint[] = [];

  for (const ev of events) {
    const kind = (ev as { eventType?: unknown } | null)?.eventType;
    if (kind === "market.depth") {
      const { depth, errors: errs } = normalizeDepthEvent(ev);
      if (depth) {
        quoteHub.ingestDepth(depth);
        recordDepthSnapshot(depth);
        accepted += 1;
        depthLadders += 1;
      } else {
        rejected += 1;
        if (errors.length < 10) errors.push(...errs);
      }
      continue;
    }
    if (kind === "market.trade") {
      const { trade, errors: errs } = normalizeTradeEvent(ev);
      if (trade) {
        const quote = quoteHub.get(trade.instrumentId);
        const { side, sideSource } = classifyTradeSide(trade.side, trade.price, quote?.bid, quote?.ask);
        const enriched = { ...trade, side, sideSource };
        quoteHub.ingestTrade(enriched);
        pendingTrades.push({ trade: enriched, sideSource });
        accepted += 1;
        trades += 1;
      } else {
        rejected += 1;
        if (errors.length < 10) errors.push(...errs);
      }
      continue;
    }
    const { quote, errors: errs } = normalizeBridgeEvent(ev);
    if (quote) {
      quoteHub.ingest(quote);
      accepted += 1;
      quotes += 1;
    } else {
      rejected += 1;
      if (errors.length < 10) errors.push(...errs);
    }
  }

  recordTradePrints(pendingTrades);
  quoteHub.setFeedConnection("ninjatrader", true);
  return ok({ accepted, rejected, quotes, depthLadders, trades, errors, serverTime: new Date().toISOString() });
});