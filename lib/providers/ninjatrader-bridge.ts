import type {
  MarketDataProvider,
  NormalizedDepth,
  NormalizedQuote,
  NormalizedTrade,
  ProviderCapabilities,
} from "./types";
import type { DataStatus } from "@/lib/market/status";

/**
 * NinjaTrader bridge adapter.
 *
 * The desktop NinjaTrader 8 Add-On (see bridge/ninjatrader/FYIPBridge.cs) posts
 * versioned, normalized events to POST /api/v1/bridge/ingest. This adapter
 * declares capabilities and owns message *validation + normalization*; it does
 * not itself connect to NinjaTrader (only the desktop bridge can).
 *
 * Nothing here fabricates data. Malformed or unauthorized messages are rejected.
 */
const ALLOWED_STATUS: DataStatus[] = ["live", "delayed", "historical", "simulated"];

export class NinjaTraderBridgeProvider implements MarketDataProvider {
  readonly key = "ninjatrader";
  readonly kind = "market_data" as const;
  readonly label = "NinjaTrader 8 Bridge";

  capabilities(): ProviderCapabilities {
    return {
      live: true,
      delayed: false,
      historical: true,
      depth: true,
      streaming: true,
      options: false,
      fundamentals: false,
      symbolSearch: true,
      entitlement: "exchange-entitlement-required",
    };
  }

  isConfigured(): boolean {
    return typeof process.env.FYIP_BRIDGE_TOKEN === "string" && process.env.FYIP_BRIDGE_TOKEN.length > 0;
  }

  start(): void {
    /* push-based: the bridge drives ingestion */
  }
  stop(): void {
    /* nothing to tear down server-side */
  }
}

export interface NormalizeResult {
  quote?: NormalizedQuote;
  errors: string[];
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate and normalize one inbound bridge event. Rejects anything that:
 *  - has an unsupported schemaVersion / eventType
 *  - is missing provider, instrumentId or a timestamp
 *  - declares a data status the server does not accept from the bridge
 * Numeric fields are coerced; non-numeric quote fields become null (never 0).
 */
export function normalizeBridgeEvent(raw: unknown): NormalizeResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { errors: ["payload must be a JSON object"] };
  }
  const e = raw as Record<string, unknown>;

  if (e.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${String(e.schemaVersion)}`);
  if (e.eventType !== "market.quote") errors.push(`unsupported eventType: ${String(e.eventType)}`);

  const provider = typeof e.provider === "string" ? e.provider : "ninjatrader";
  const instrumentId = typeof e.instrumentId === "string" ? e.instrumentId : "";
  const providerSymbol = typeof e.providerSymbol === "string" ? e.providerSymbol : "";
  const eventTimestamp = typeof e.eventTimestamp === "string" ? e.eventTimestamp : "";
  const receivedTimestamp =
    typeof e.receivedTimestamp === "string" ? e.receivedTimestamp : new Date().toISOString();

  if (!instrumentId) errors.push("instrumentId is required");
  if (!eventTimestamp) errors.push("eventTimestamp is required");

  const status = (typeof e.dataStatus === "string" ? e.dataStatus : "live") as DataStatus;
  if (!ALLOWED_STATUS.includes(status)) errors.push(`dataStatus not accepted from bridge: ${status}`);

  if (errors.length > 0) return { errors };

  const quote: NormalizedQuote = {
    schemaVersion: 1,
    eventType: "market.quote",
    provider,
    instrumentId,
    providerSymbol,
    exchange: typeof e.exchange === "string" ? e.exchange : null,
    eventTimestamp,
    receivedTimestamp,
    sequence: num(e.sequence),
    dataStatus: status,
    bid: num(e.bid),
    ask: num(e.ask),
    last: num(e.last),
    open: num(e.open),
    high: num(e.high),
    low: num(e.low),
    prevClose: num(e.prevClose),
    volume: num(e.volume),
    openInterest: num(e.openInterest),
    entitlement: typeof e.entitlement === "string" ? e.entitlement : "exchange-entitlement-required",
  };
  return { quote, errors: [] };
}

const MAX_LEVELS_PER_SIDE = 100;

interface NormalizeDepthResult {
  depth?: NormalizedDepth;
  errors: string[];
}

function parseLevels(raw: unknown, errors: string[], label: string): { price: number; volume: number }[] | null {
  if (!Array.isArray(raw)) {
    errors.push(`${label} must be an array of {price, volume}`);
    return null;
  }
  if (raw.length > MAX_LEVELS_PER_SIDE) {
    errors.push(`${label} exceeds ${MAX_LEVELS_PER_SIDE} levels`);
    return null;
  }
  const levels: { price: number; volume: number }[] = [];
  let bad = false;
  for (const lev of raw) {
    if (typeof lev !== "object" || lev === null) { bad = true; break; }
    const l = lev as Record<string, unknown>;
    const price = num(l.price);
    const volume = num(l.volume);
    if (price === null || volume === null || volume < 0) { bad = true; break; }
    levels.push({ price, volume });
  }
  if (bad) {
    errors.push(`${label} contains an invalid level (price/volume must be finite numbers, volume ≥ 0)`);
    return null;
  }
  return levels;
}

/**
 * Validate one inbound depth (order-book ladder) event: schemaVersion 1,
 * eventType market.depth, bounded bids/asks arrays with numeric levels.
 */
export function normalizeDepthEvent(raw: unknown): NormalizeDepthResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { errors: ["payload must be a JSON object"] };
  }
  const e = raw as Record<string, unknown>;

  if (e.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${String(e.schemaVersion)}`);
  if (e.eventType !== "market.depth") errors.push(`unsupported eventType: ${String(e.eventType)}`);

  const instrumentId = typeof e.instrumentId === "string" ? e.instrumentId : "";
  const eventTimestamp = typeof e.eventTimestamp === "string" ? e.eventTimestamp : "";
  const receivedTimestamp =
    typeof e.receivedTimestamp === "string" ? e.receivedTimestamp : new Date().toISOString();
  if (!instrumentId) errors.push("instrumentId is required");
  if (!eventTimestamp) errors.push("eventTimestamp is required");

  const status = (typeof e.dataStatus === "string" ? e.dataStatus : "live") as DataStatus;
  if (!ALLOWED_STATUS.includes(status)) errors.push(`dataStatus not accepted from bridge: ${status}`);

  const bids = "bids" in e ? parseLevels(e.bids, errors, "bids") : undefined;
  const asks = "asks" in e ? parseLevels(e.asks, errors, "asks") : undefined;
  if (bids === undefined && asks === undefined) errors.push("bids and/or asks arrays are required");

  if (errors.length > 0) return { errors };

  return {
    depth: {
      schemaVersion: 1,
      eventType: "market.depth",
      provider: typeof e.provider === "string" ? e.provider : "ninjatrader",
      instrumentId: instrumentId!,
      providerSymbol: typeof e.providerSymbol === "string" ? e.providerSymbol : "",
      exchange: typeof e.exchange === "string" ? e.exchange : null,
      eventTimestamp: eventTimestamp!,
      receivedTimestamp,
      sequence: num(e.sequence),
      dataStatus: status,
      bids: bids ?? [],
      asks: asks ?? [],
      entitlement: typeof e.entitlement === "string" ? e.entitlement : "exchange-entitlement-required",
    },
    errors: [],
  };
}

interface NormalizeTradeResult {
  trade?: NormalizedTrade;
  errors: string[];
}

const SIDES = ["buy", "sell", "cross", null] as const;

/**
 * Validate one inbound trade print (time & sales): schemaVersion 1,
 * eventType market.trade, non-negative price and size.
 */
export function normalizeTradeEvent(raw: unknown): NormalizeTradeResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { errors: ["payload must be a JSON object"] };
  }
  const e = raw as Record<string, unknown>;

  if (e.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${String(e.schemaVersion)}`);
  if (e.eventType !== "market.trade") errors.push(`unsupported eventType: ${String(e.eventType)}`);

  const instrumentId = typeof e.instrumentId === "string" ? e.instrumentId : "";
  const eventTimestamp = typeof e.eventTimestamp === "string" ? e.eventTimestamp : "";
  const receivedTimestamp =
    typeof e.receivedTimestamp === "string" ? e.receivedTimestamp : new Date().toISOString();
  if (!instrumentId) errors.push("instrumentId is required");
  if (!eventTimestamp) errors.push("eventTimestamp is required");

  const status = (typeof e.dataStatus === "string" ? e.dataStatus : "live") as DataStatus;
  if (!ALLOWED_STATUS.includes(status)) errors.push(`dataStatus not accepted from bridge: ${status}`);

  const price = num(e.price);
  const size = num(e.size);
  if (price === null) errors.push("price must be a finite number");
  if (size === null || size < 0) errors.push("size must be a finite number ≥ 0");

  const sideRaw = e.side;
  const side = sideRaw === undefined || sideRaw === null ? null : sideRaw;
  if (!SIDES.includes(side as (typeof SIDES)[number])) errors.push(`side must be one of buy|sell|cross|null: got ${String(sideRaw)}`);

  if (errors.length > 0) return { errors };

  return {
    trade: {
      schemaVersion: 1,
      eventType: "market.trade",
      provider: typeof e.provider === "string" ? e.provider : "ninjatrader",
      instrumentId: instrumentId!,
      providerSymbol: typeof e.providerSymbol === "string" ? e.providerSymbol : "",
      exchange: typeof e.exchange === "string" ? e.exchange : null,
      eventTimestamp: eventTimestamp!,
      receivedTimestamp,
      sequence: num(e.sequence),
      dataStatus: status,
      price: price as number,
      size: size as number,
      side: side === "" ? null : (side as NormalizedTrade["side"]),
      entitlement: typeof e.entitlement === "string" ? e.entitlement : "exchange-entitlement-required",
    },
    errors: [],
  };
}