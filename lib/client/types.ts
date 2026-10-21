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

/* ------------------------------- FYP NEWS ------------------------------- */

export type NewsPriorityDTO = "breaking" | "high" | "scheduled" | "market" | "research" | "general";
export type NewsVerificationDTO = "official" | "corroborated" | "multi-source" | "single-source" | "unverified";
export type NewsDirectionDTO = "up" | "down" | "two-way" | "watch";

export interface NewsImpactDTO {
  symbol: string;
  assetClass: string;
  direction: NewsDirectionDTO;
  mechanism: string;
  confidence: number;
  isInterpretation: true;
}

export interface NewsSourceRefDTO {
  providerKey: string;
  sourceName: string;
  url: string | null;
  publishedAt: string | null;
  receivedAt: string;
  official: boolean;
}

export interface NewsStoryDTO {
  id: string;
  providerKey: string;
  providerItemId: string;
  sourceName: string;
  sourceHomepage: string | null;
  url: string | null;
  canonicalUrl: string | null;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  publishedKnown: boolean;
  sourceUpdatedAt: string | null;
  receivedAt: string;
  ingestedAt: string;
  updatedAt: string;
  country: string | null;
  region: string;
  category: string;
  subcategory: string | null;
  entities: string[];
  keywords: string[];
  assetClasses: string[];
  symbols: string[];
  urgency: number;
  relevance: number;
  priority: NewsPriorityDTO;
  verification: NewsVerificationDTO;
  sourceCount: number;
  sources: NewsSourceRefDTO[];
  clusterId: string;
  status: "new" | "updated" | "developing";
  isBreaking: boolean;
  contentHash: string;
  dedupeKey: string;
  attribution: string;
  license: string;
  isFixture: boolean;
  impacts: NewsImpactDTO[];
  saved: boolean;
  clusterSize: number;
}

export interface NewsCountsDTO {
  total: number;
  last24h: number;
  breaking: number;
  saved: number;
}

export interface NewsSourceHealthDTO {
  key: string;
  name: string;
  kind: string;
  homepage: string | null;
  endpoint: string | null;
  enabled: boolean;
  official: boolean;
  attribution: string;
  license: string;
  intervalSeconds: number;
  regionHint: string | null;
  categoryHint: string | null;
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  itemsTotal: number;
  lastLatencyMs: number | null;
  lastItemCount: number;
  unavailableReason: string | null;
  status: "ok" | "stale" | "error" | "pending" | "disabled" | "unavailable";
}

export interface NewsSourceFacetDTO {
  key: string;
  name: string;
  count: number;
}

export interface NewsStoriesDTO {
  stories: NewsStoryDTO[];
  total: number;
  limit: number;
  offset: number;
  counts: NewsCountsDTO;
  sources: NewsSourceFacetDTO[];
  hasRealContent: boolean;
  lastCollectionAt: string | null;
  generatedAt: string;
  methodology: string;
  disclaimer: string;
}

export interface NewsAiStatusDTO {
  enabled: boolean;
  model: string | null;
  reason: string | null;
}

export interface NewsHealthDTO {
  generatedAt: string;
  counts: NewsCountsDTO;
  sources: NewsSourceHealthDTO[];
  enabledSources: number;
  healthySources: number;
  lastRun: NewsIngestRunDTO | null;
  collection: {
    mode: string;
    collectionEnabled: boolean;
    retentionDays: number;
    note: string;
  };
  ai: NewsAiStatusDTO;
  methodology: string;
  disclaimer: string;
}

export interface NewsIngestSourceDetailDTO {
  key: string;
  status: "ok" | "not-modified" | "error" | "skipped";
  items: number;
  inserted: number;
  merged: number;
  clustered: number;
  duplicates: number;
  latencyMs: number;
  error?: string;
}

export interface NewsIngestRunDTO {
  id: number;
  startedAt: string;
  finishedAt: string;
  providersTried: number;
  itemsSeen: number;
  inserted: number;
  merged: number;
  clustered: number;
  errors: number;
  detail: unknown;
}

export interface NewsSettingsDTO {
  retentionDays: number;
  collectionEnabled: boolean;
  customKeywords: Record<string, string[]>;
  lastPruneAt: string | null;
}

export interface NewsAdminDTO {
  settings: NewsSettingsDTO;
  sources: NewsSourceHealthDTO[];
  ai: NewsAiStatusDTO;
  policy: {
    endpointsEditable: boolean;
    note: string;
    minIntervalSeconds: number;
    maxIntervalSeconds: number;
  };
}

export interface NewsCollectSummaryDTO {
  startedAt: string;
  finishedAt: string;
  providersTried: number;
  itemsSeen: number;
  inserted: number;
  merged: number;
  clustered: number;
  errors: number;
  budgetExhausted: boolean;
  details: NewsIngestSourceDetailDTO[];
  counts?: NewsCountsDTO;
  collectionEnabled?: boolean;
  mode?: string;
}

export interface NewsDetailDTO {
  story: NewsStoryDTO;
  related: NewsStoryDTO[];
  sources: NewsSourceHealthDTO[];
  ai: NewsAiStatusDTO;
  methodology: string;
  disclaimer: string;
}

export interface NewsSummarizeDTO {
  enabled: boolean;
  reason?: string;
  storyId?: string;
  summary?: string;
  model?: string;
  generatedAt?: string;
  notice?: string;
}
