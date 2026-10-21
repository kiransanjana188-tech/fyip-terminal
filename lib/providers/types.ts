import type { DataStatus } from "@/lib/market/status";

/**
 * Provider adapter contracts. One interface per data class so vendors can be
 * swapped without touching the UI. Every provider must declare its capabilities
 * explicitly — the application never assumes a capability is present.
 */

export type ProviderKind = "market_data" | "news" | "economic" | "options" | "ai";

export interface ProviderCapabilities {
  live: boolean;
  delayed: boolean;
  historical: boolean;
  depth: boolean;
  streaming: boolean;
  options: boolean;
  fundamentals: boolean;
  symbolSearch: boolean;
  /** Free-form entitlement note, e.g. "exchange depth requires L2 subscription". */
  entitlement: string;
}

export interface NormalizedQuote {
  schemaVersion: 1;
  eventType: "market.quote";
  provider: string;
  instrumentId: string;
  providerSymbol: string;
  exchange: string | null;
  eventTimestamp: string;
  receivedTimestamp: string;
  sequence: number | null;
  dataStatus: DataStatus;
  bid: number | null;
  ask: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  openInterest: number | null;
  entitlement: string | null;
}

/** One order-book price level as reported by a bridge/venue source. */
export interface DepthLevel {
  price: number;
  volume: number;
}

export interface NormalizedDepth {
  schemaVersion: 1;
  eventType: "market.depth";
  provider: string;
  instrumentId: string;
  providerSymbol: string;
  exchange: string | null;
  eventTimestamp: string;
  receivedTimestamp: string;
  sequence: number | null;
  dataStatus: DataStatus;
  /** Best bid first, descending; ≤30 levels enforced by the normalizer. */
  bids: DepthLevel[];
  /** Best ask first, ascending; ≤30 levels enforced by the normalizer. */
  asks: DepthLevel[];
  entitlement: string | null;
}

export interface NormalizedTrade {
  schemaVersion: 1;
  eventType: "market.trade";
  provider: string;
  instrumentId: string;
  providerSymbol: string;
  exchange: string | null;
  eventTimestamp: string;
  receivedTimestamp: string;
  sequence: number | null;
  dataStatus: DataStatus;
  price: number;
  size: number;
  /** "aggressive" side (buyer/seller initiated) when derivable, else null. */
  side: "buy" | "sell" | "cross" | null;
  /** How `side` was determined. Inferred means classified against the book at ingest. */
  sideSource?: "provider" | "inferred" | "unknown";
  entitlement: string | null;
}

export type NormalizedMarketEvent = NormalizedQuote | NormalizedDepth | NormalizedTrade;

export interface MarketDataProvider {
  readonly key: string;
  readonly kind: "market_data";
  readonly label: string;
  capabilities(): ProviderCapabilities;
  /** Whether this provider is currently configured (credentials present). */
  isConfigured(): boolean;
  /**
   * Called once at boot. Providers that stream (bridge, websocket) register a
   * sink here; request/response providers may no-op.
   */
  start(sink: (quote: NormalizedQuote) => void): void;
  stop(): void;
  /** Request/response fetch of the current quote, or null if unsupported. */
  fetchQuote?(instrumentId: string, providerSymbol: string): Promise<NormalizedQuote | null>;
}

export interface NormalizedNewsItem {
  id: string;
  sourceKey: string;
  headline: string;
  summary: string | null;
  url: string | null;
  priority: "breaking" | "high" | "scheduled" | "market" | "research" | "general";
  priorityRule: string;
  categories: string[];
  instruments: string[];
  publishedAt: string;
  receivedAt: string;
  ingestedVia: string;
  isFixture: boolean;
}

export interface NewsProvider {
  readonly key: string;
  readonly kind: "news";
  readonly label: string;
  isConfigured(): boolean;
  capabilities(): Pick<ProviderCapabilities, "live" | "historical" | "streaming" | "entitlement">;
  fetchRecent(limit: number): Promise<NormalizedNewsItem[]>;
  search?(query: string, limit: number): Promise<NormalizedNewsItem[]>;
}

export interface EconomicSeriesPoint {
  period: string;
  value: number | null;
  source: string;
  sourceUrl?: string | null;
}

export interface EconomicDataProvider {
  readonly key: string;
  readonly kind: "economic";
  readonly label: string;
  isConfigured(): boolean;
  capabilities(): Pick<ProviderCapabilities, "historical" | "live" | "entitlement">;
  fetchSeries(country: string, indicator: string): Promise<EconomicSeriesPoint[]>;
}

export interface OptionContractQuote {
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  bid: number | null;
  ask: number | null;
  last: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVol: number | null;
  greeksSource: "provider" | "fyip_calculated" | "unavailable";
  /** Provider-supplied gamma when available; otherwise FYIP computes it from IV. */
  gamma?: number | null;
  /** Underlying spot at snapshot time, repeated on each row by most vendors. */
  underlyingPrice?: number | null;
  /** Status reported by the source for this row when it carries one. */
  dataStatus?: DataStatus;
  /** Snapshot timestamp for this contract/chain. */
  asOf?: string;
}

export interface OptionsDataProvider {
  readonly key: string;
  readonly kind: "options";
  readonly label: string;
  isConfigured(): boolean;
  capabilities(): Pick<ProviderCapabilities, "live" | "historical" | "options" | "entitlement">;
  fetchChain(underlyingId: string): Promise<OptionContractQuote[]>;
  /** Symbols this adapter can serve. `undefined` means the vendor decides per entitlement. */
  supportedSymbols?(): readonly string[];
}

export interface ProviderSummary {
  key: string;
  kind: ProviderKind;
  label: string;
  configured: boolean;
  capabilities: ProviderCapabilities;
  /** Human-readable blocker when not configured. */
  blocker: string | null;
}