/**
 * FYP NEWS domain types.
 *
 * Everything here is provider-agnostic. A provider adapter normalizes its
 * payload into `ParsedNewsItem`; the pipeline turns that into a
 * `NormalizedNewsStory` before it is persisted. No fabricated timestamps or
 * facts are allowed anywhere in this chain.
 */

export type NewsPriority = "breaking" | "high" | "scheduled" | "market" | "research" | "general";

export type NewsCategory =
  | "breaking"
  | "geopolitics"
  | "central-banks"
  | "macro"
  | "inflation-employment"
  | "rates"
  | "equities"
  | "technology"
  | "forex"
  | "commodities"
  | "gold"
  | "crypto"
  | "risk"
  | "regulation-trade"
  | "company"
  | "general";

export type NewsRegion =
  | "united-states"
  | "europe"
  | "united-kingdom"
  | "middle-east"
  | "china"
  | "india"
  | "japan"
  | "asia-pacific"
  | "canada"
  | "australia"
  | "global";

export type NewsVerification =
  | "official"
  | "corroborated"
  | "multi-source"
  | "single-source"
  | "unverified";

export type NewsStoryStatus = "new" | "updated" | "developing";

export type ImpactDirection = "up" | "down" | "two-way" | "watch";

export interface NewsImpact {
  symbol: string;
  assetClass: string;
  direction: ImpactDirection;
  /** Short rule-based transmission mechanism. Always framed as potential. */
  mechanism: string;
  /** Rule confidence (not a market probability). 0..1. */
  confidence: number;
  isInterpretation: true;
}

/** One source report that contributed to a story. */
export interface StorySourceRef {
  providerKey: string;
  sourceName: string;
  url: string | null;
  publishedAt: string | null;
  receivedAt: string;
  /** Provider itself is an official primary source (central bank, SEC, etc.). */
  official: boolean;
}

export interface ParsedNewsItem {
  /** Provider-local identifier (guid/id/url). Required for stable dedupe. */
  providerItemId: string;
  title: string;
  url: string | null;
  summary: string | null;
  publishedAt: string | null;
  /** False when the feed did not supply a usable publication time. */
  publishedKnown: boolean;
  sourceUpdatedAt: string | null;
  /** Provider-specific publisher/domain, e.g. a GDELT article domain. */
  publisher: string | null;
  country: string | null;
}

export interface ParsedFeed {
  items: ParsedNewsItem[];
  feedTitle: string | null;
  feedUpdatedAt: string | null;
  skipped: number;
}

export interface NormalizedNewsStory {
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
  region: NewsRegion;
  category: NewsCategory;
  subcategory: string | null;
  entities: string[];
  keywords: string[];
  assetClasses: string[];
  symbols: string[];
  urgency: number;
  relevance: number;
  priority: NewsPriority;
  verification: NewsVerification;
  sourceCount: number;
  sources: StorySourceRef[];
  clusterId: string;
  status: NewsStoryStatus;
  isBreaking: boolean;
  contentHash: string;
  dedupeKey: string;
  attribution: string;
  license: string;
  isFixture: boolean;
  impacts: NewsImpact[];
}

export type FeedFormat = "rss" | "atom" | "gdelt-json";

export interface NewsProviderDefinition {
  key: string;
  name: string;
  /** Broad source type used for attribution and verification rules. */
  kind: "official" | "government" | "central-bank" | "company" | "aggregator" | "wire";
  homepage: string;
  endpoint: string | null;
  format: FeedFormat;
  /** Minimum seconds between successful polls. */
  intervalSeconds: number;
  timeoutMs: number;
  attribution: string;
  license: string;
  regionHint: NewsRegion;
  categoryHint: NewsCategory | null;
  official: boolean;
  /** Disabled providers can be shown with an honest reason instead of being called. */
  enabledByDefault: boolean;
  unavailableReason?: string;
  /** Extra request headers (never secrets for these public feeds). */
  headers?: Record<string, string>;
}
