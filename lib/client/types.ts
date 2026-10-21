/**
 * Client-safe DTO types. Deliberately independent of server modules so that no
 * `node:*` import can ever leak into a browser bundle.
 */
export type DataStatus =
  | "live" | "delayed" | "stale" | "disconnected" | "historical" | "simulated" | "unavailable";

export interface QuoteView {
  instrumentId: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  currency: string;
  exchange: string | null;
  priceScale: number;
  tickSize: number;
  provider: string | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  spread: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  openInterest: number | null;
  change: number | null;
  changePct: number | null;
  dataStatus: DataStatus;
  entitlement: string | null;
  eventTimestamp: string | null;
  receivedTimestamp: string | null;
  sessionState: string;
  /** Continuous futures only: the front contract feeding this view. */
  resolvedContract?: string | null;
}

export interface StreamQuote {
  instrumentId: string;
  symbol: string;
  displayName: string;
  assetClass: string;
  provider: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  openInterest: number | null;
  eventTimestamp: string;
  receivedTimestamp: string;
  status: DataStatus;
  dataStatus: DataStatus;
  entitlement: string | null;
}

export interface DepthLevelDTO {
  price: number;
  volume: number;
}

export interface DepthLadderDTO {
  instrumentId: string;
  providerSymbol: string;
  symbol: string;
  eventTimestamp: string;
  receivedTimestamp: string;
  dataStatus: DataStatus;
  status?: DataStatus;
  bids: DepthLevelDTO[];
  asks: DepthLevelDTO[];
  provider: string;
  entitlement: string | null;
}

export interface TradePrintDTO {
  id?: number;
  instrumentId: string;
  symbol: string;
  providerSymbol: string | null;
  price: number;
  size: number;
  side: "buy" | "sell" | "cross" | null;
  sideSource?: "provider" | "inferred" | "unknown";
  eventTimestamp: string;
  receivedTimestamp: string;
  dataStatus: DataStatus;
  provider: string;
}

export interface OrderflowStatsDTO {
  tradeCount?: number;
  depthCount?: number;
  firstTradeAt?: string | null;
  lastTradeAt?: string | null;
  firstDepthAt?: string | null;
  lastDepthAt?: string | null;
  returned: number;
}

export interface TradeHistoryDTO {
  symbol: string;
  contractSymbol: string;
  instrumentId: string;
  displayName: string;
  tickSize: number;
  priceScale: number;
  source: string;
  dataStatus: DataStatus;
  trades: TradePrintDTO[];
  stats: OrderflowStatsDTO;
}

export interface DepthSnapshotDTO {
  eventTimestamp: string;
  receivedTimestamp: string;
  bids: DepthLevelDTO[];
  asks: DepthLevelDTO[];
}

export interface DepthHistoryDTO {
  symbol: string;
  contractSymbol: string;
  instrumentId: string;
  displayName: string;
  tickSize: number;
  priceScale: number;
  source: string;
  dataStatus: DataStatus;
  snapshots: DepthSnapshotDTO[];
  stats: OrderflowStatsDTO;
}

export interface Instrument {
  id: string;
  symbol: string;
  display_name: string;
  asset_class: string;
  exchange_id: string | null;
  currency: string;
  price_scale: number;
  tick_size: number;
  contract_multiplier: number;
  expiration: string | null;
  futures_month: string | null;
  futures_year: number | null;
  is_continuous: number;
  roll_methodology: string | null;
  underlying_kind: string | null;
  status: string;
}

export interface NewsItemDTO {
  id: string;
  source_key: string;
  headline: string;
  summary: string | null;
  url: string | null;
  priority: "breaking" | "high" | "scheduled" | "market" | "research" | "general";
  priority_rule: string;
  categories: string[];
  instruments: string[];
  published_at: string;
  received_at: string;
  ingested_via: string;
  is_fixture: number;
}

export interface EconEventDTO {
  id: string;
  country: string;
  indicator: string;
  importance: string;
  scheduled_at: string;
  timezone: string;
  unit: string | null;
  source: string;
  status: string;
  is_fixture: number;
}

export interface AlertDTO {
  id: string;
  name: string;
  kind: string;
  target: string | null;
  condition: string;
  delivery: string;
  enabled: number;
  state: string;
  last_fired_at: string | null;
}

export interface AlertEventDTO {
  id: string;
  alert_id: string;
  fired_at: string;
  message: string;
  source: string | null;
}

export interface ProviderDTO {
  key: string;
  kind: string;
  label: string;
  configured: boolean;
  enabledInDb?: boolean;
  capabilities: Record<string, unknown>;
  blocker: string | null;
  notes?: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  permissions: string[];
}