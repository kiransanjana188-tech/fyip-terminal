import { createHash } from "node:crypto";
import { canonicalizeUrl } from "./dedupe";
import { CATEGORY_ORDER, classify, hasUncertaintyLanguage } from "./taxonomy";
import type {
  NewsCategory,
  NewsImpact,
  NormalizedNewsStory,
  NewsProviderDefinition,
  NewsVerification,
  ParsedNewsItem,
  StorySourceRef,
} from "./types";

export const NEWS_DISCLAIMER =
  "Market-impact notes are rule-based interpretations of potential transmission channels, not forecasts, recommendations or trading signals.";

export const NEWS_METHODOLOGY =
  "FYP NEWS aggregates public provider feeds. Verification labels reflect source type and the number of independent providers in this module; repeated reporting is not independent confirmation. Timestamps come from the provider where available; otherwise publication time is shown as unknown. FYIP never invents times, quotes or facts.";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function storyIdFor(providerKey: string, providerItemId: string): string {
  return `ns_${sha256(`${providerKey}|${providerItemId}`).slice(0, 26)}`;
}

export function contentHashFor(title: string, summary: string | null): string {
  return sha256(`${title.trim().toLowerCase()}|${(summary ?? "").trim().toLowerCase()}`).slice(0, 40);
}

export function dedupeKeyFor(providerKey: string, providerItemId: string): string {
  return sha256(`${providerKey}|${providerItemId}`).slice(0, 48);
}

export function sourceRefFor(item: ParsedNewsItem, provider: NewsProviderDefinition, receivedAt: string): StorySourceRef {
  return {
    providerKey: provider.key,
    sourceName: provider.name,
    url: item.url,
    publishedAt: item.publishedAt,
    receivedAt,
    official: provider.official,
  };
}

export function verificationFor(sources: StorySourceRef[], text: string): NewsVerification {
  if (hasUncertaintyLanguage(text)) return "unverified";
  if (sources.some((source) => source.official)) return "official";
  const providers = new Set(sources.map((source) => source.providerKey));
  if (providers.size >= 3) return "corroborated";
  if (providers.size >= 2) return "multi-source";
  return "single-source";
}

export function buildNormalizedStory(input: {
  item: ParsedNewsItem;
  provider: NewsProviderDefinition;
  now?: Date;
  /** Override received time (defaults to now; never a provider publication time). */
  receivedAt?: string;
  extraKeywords?: Partial<Record<NewsCategory, string[]>>;
}): NormalizedNewsStory {
  const now = input.now ?? new Date();
  const receivedAt = input.receivedAt ?? now.toISOString();
  const canonicalUrl = canonicalizeUrl(input.item.url, input.provider.homepage);
  const classification = classify({
    title: input.item.title,
    summary: input.item.summary,
    providerCategoryHint: input.provider.categoryHint,
    providerRegionHint: input.provider.regionHint === "global" ? null : input.provider.regionHint,
    officialSource: input.provider.official,
    extraKeywords: input.extraKeywords,
  });
  const id = storyIdFor(input.provider.key, input.item.providerItemId);
  const source = sourceRefFor(input.item, input.provider, receivedAt);
  const text = `${input.item.title} ${input.item.summary ?? ""}`;
  return {
    id,
    providerKey: input.provider.key,
    providerItemId: input.item.providerItemId,
    sourceName: input.provider.name,
    sourceHomepage: input.provider.homepage,
    url: input.item.url,
    canonicalUrl,
    title: input.item.title,
    summary: input.item.summary,
    publishedAt: input.item.publishedAt,
    publishedKnown: input.item.publishedKnown,
    sourceUpdatedAt: input.item.sourceUpdatedAt,
    receivedAt,
    ingestedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    country: input.item.country ?? classification.country,
    region: classification.region,
    category: classification.category,
    subcategory: classification.subcategory,
    entities: classification.entities,
    keywords: classification.keywords,
    assetClasses: classification.assetClasses,
    symbols: classification.symbols,
    urgency: classification.urgency,
    relevance: classification.relevance,
    priority: classification.priority,
    verification: verificationFor([source], text),
    sourceCount: 1,
    sources: [source],
    clusterId: id,
    status: "new",
    isBreaking: classification.isBreaking,
    contentHash: contentHashFor(input.item.title, input.item.summary),
    dedupeKey: dedupeKeyFor(input.provider.key, input.item.providerItemId),
    attribution: input.provider.attribution,
    license: input.provider.license,
    isFixture: false,
    impacts: classification.impacts,
  };
}

export interface DuplicateMerge {
  patch: {
    sources: StorySourceRef[];
    sourceCount: number;
    verification: NewsVerification;
    updatedAt: string;
    status: "updated";
    summary: string | null;
    isBreaking: boolean;
    priority: NormalizedNewsStory["priority"];
    urgency: number;
    relevance: number;
    symbols: string[];
    assetClasses: string[];
    impacts: NewsImpact[];
  };
  changed: boolean;
}

/**
 * Merge a newly received report into an existing near-identical story without
 * overwriting the original headline or fabricating new details.
 */
export function mergeDuplicateStory(
  existing: NormalizedNewsStory,
  item: ParsedNewsItem,
  provider: NewsProviderDefinition,
  now = new Date(),
): DuplicateMerge {
  const incomingSource = sourceRefFor(item, provider, now.toISOString());
  const sources = [...existing.sources];
  const existingIndex = sources.findIndex((source) => source.providerKey === provider.key);
  if (existingIndex >= 0) {
    // Keep one reference per provider. Prefer the newest publication time.
    const current = sources[existingIndex];
    const currentPublished = current.publishedAt ? Date.parse(current.publishedAt) : Number.NEGATIVE_INFINITY;
    const incomingPublished = incomingSource.publishedAt ? Date.parse(incomingSource.publishedAt) : Number.NEGATIVE_INFINITY;
    if (incomingPublished >= currentPublished) sources[existingIndex] = incomingSource;
  } else {
    sources.push(incomingSource);
  }

  const sourceCount = new Set(sources.map((source) => source.providerKey)).size;
  const text = `${existing.title} ${existing.summary ?? ""}`;
  const verification = verificationFor(sources, text);
  const changed = sourceCount > existing.sourceCount || verification !== existing.verification;

  const impacts = existing.impacts.length > 0 ? existing.impacts : classify({
    title: existing.title,
    summary: existing.summary,
    officialSource: existing.verification === "official",
  }).impacts;

  return {
    patch: {
      sources,
      sourceCount,
      verification,
      updatedAt: now.toISOString(),
      status: "updated",
      summary: existing.summary ?? item.summary,
      isBreaking: existing.isBreaking,
      priority: existing.priority,
      urgency: existing.urgency,
      relevance: existing.relevance,
      symbols: existing.symbols.length ? existing.symbols : impacts.map((impact) => impact.symbol),
      assetClasses: existing.assetClasses.length ? existing.assetClasses : [...new Set(impacts.map((impact) => impact.assetClass))],
      impacts,
    },
    changed,
  };
}

/** Exponential backoff, capped. Retry-After wins when larger. */
export function retryDelayMs(
  failures: number,
  baseIntervalMs: number,
  retryAfterSeconds: number | null = null,
  maxMs = 30 * 60_000,
): number {
  const exponent = Math.min(Math.max(failures, 0), 6);
  const backoff = baseIntervalMs * Math.pow(2, exponent);
  const retryAfter = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  return Math.min(maxMs, Math.max(baseIntervalMs, backoff, retryAfter));
}

export function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

export function retryAfterFromHeaders(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 1800);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.min(Math.max(0, (date - Date.now()) / 1000), 1800);
  return null;
}

/** Parse admin-entered keyword lists conservatively. */
export function sanitizeCustomKeywords(input: unknown): Partial<Record<NewsCategory, string[]>> {
  if (!input || typeof input !== "object") return {};
  const categories = new Set<NewsCategory>(CATEGORY_ORDER);
  const output: Partial<Record<NewsCategory, string[]>> = {};
  for (const [rawCategory, rawList] of Object.entries(input as Record<string, unknown>)) {
    const category = rawCategory as NewsCategory;
    if (!categories.has(category)) continue;
    const values = Array.isArray(rawList)
      ? rawList
      : typeof rawList === "string"
        ? rawList.split(",")
        : [];
    const keywords = [...new Set(values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase().replace(/\s+/g, " ").trim())
      .filter((value) => value.length >= 2 && value.length <= 40))]
      .slice(0, 10);
    if (keywords.length) output[category] = keywords;
  }
  return output;
}

export function sseFrame(event: string, data: unknown, id?: string): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload.split("\n").map((line) => `data: ${line}`).join("\n");
  return `${id ? `id: ${id}\n` : ""}event: ${event}\n${lines}\n\n`;
}
