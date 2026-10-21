import { execute, getDb, queryAll, queryOne } from "@/lib/db";
import { canonicalizeUrl } from "./dedupe";
import { compareReports } from "./dedupe";
import {
  buildNormalizedStory,
  contentHashFor,
  dedupeKeyFor,
  mergeDuplicateStory,
  type DuplicateMerge,
} from "./pipeline";
import type {
  NewsCategory,
  NewsImpact,
  NewsPriority,
  NewsProviderDefinition,
  NewsVerification,
  NormalizedNewsStory,
  ParsedNewsItem,
  StorySourceRef,
} from "./types";
import { isNewsProviderKey, NEWS_PROVIDERS } from "./providers";
import { CATEGORY_ORDER, REGION_ORDER } from "./taxonomy";

/**
 * Persistence for FYP NEWS. Works identically on SQLite and Netlify Postgres
 * (the facade rewrites placeholders); avoid dialect-specific SQL beyond
 * `ON CONFLICT` which both engines support.
 */

export interface NewsSettings {
  retentionDays: number;
  collectionEnabled: boolean;
  customKeywords: Partial<Record<NewsCategory, string[]>>;
  lastPruneAt: string | null;
}

export const DEFAULT_NEWS_SETTINGS: NewsSettings = {
  retentionDays: 30,
  collectionEnabled: true,
  customKeywords: {},
  lastPruneAt: null,
};

export interface NewsStoryView extends NormalizedNewsStory {
  saved: boolean;
  clusterSize: number;
}

interface StoryRow {
  id: string;
  provider_key: string;
  provider_item_id: string;
  source_name: string;
  source_homepage: string | null;
  url: string | null;
  canonical_url: string | null;
  title: string;
  summary: string | null;
  published_at: string | null;
  published_known: number | bigint;
  source_updated_at: string | null;
  received_at: string;
  ingested_at: string;
  updated_at: string;
  country: string | null;
  region: string;
  category: string;
  subcategory: string | null;
  entities: string;
  keywords: string;
  asset_classes: string;
  symbols: string;
  urgency: number | bigint;
  relevance: number | bigint;
  priority: string;
  verification: string;
  source_count: number | bigint;
  sources: string;
  cluster_id: string;
  status: string;
  is_breaking: number | bigint;
  content_hash: string;
  dedupe_key: string;
  attribution: string | null;
  license: string | null;
  is_fixture: number | bigint;
  saved?: number | bigint;
  cluster_size?: number | bigint;
}

interface ImpactRow {
  story_id: string;
  symbol: string;
  asset_class: string;
  direction: string;
  mechanism: string;
  confidence: number | bigint | string;
  is_interpretation: number | bigint;
}

interface SourceRow {
  key: string;
  name: string;
  kind: string;
  homepage: string | null;
  enabled: number | bigint;
  endpoint: string | null;
  format: string | null;
  interval_seconds: number | bigint;
  attribution: string | null;
  license: string | null;
  region_hint: string | null;
  category_hint: string | null;
  official: number | bigint;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number | bigint;
  etag: string | null;
  last_modified: string | null;
  next_attempt_at: string | null;
  items_total: number | bigint;
  last_latency_ms: number | bigint | null;
  last_item_count: number | bigint;
  unavailable_reason: string | null;
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function parseSources(value: unknown): StorySourceRef[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        providerKey: typeof entry.providerKey === "string" ? entry.providerKey : "unknown",
        sourceName: typeof entry.sourceName === "string" ? entry.sourceName : "Unknown",
        url: typeof entry.url === "string" ? entry.url : null,
        publishedAt: typeof entry.publishedAt === "string" ? entry.publishedAt : null,
        receivedAt: typeof entry.receivedAt === "string" ? entry.receivedAt : "",
        official: entry.official === true,
      }));
  } catch {
    return [];
  }
}

export function parseImpacts(value: unknown): NewsImpact[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is NewsImpact => Boolean(entry) && typeof entry === "object");
  } catch {
    return [];
  }
}

function rowToStory(row: StoryRow, impacts: NewsImpact[] = []): NewsStoryView {
  return {
    id: row.id,
    providerKey: row.provider_key,
    providerItemId: row.provider_item_id,
    sourceName: row.source_name,
    sourceHomepage: row.source_homepage,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    summary: row.summary,
    publishedAt: row.published_at,
    publishedKnown: Number(row.published_known) === 1,
    sourceUpdatedAt: row.source_updated_at,
    receivedAt: row.received_at,
    ingestedAt: row.ingested_at,
    updatedAt: row.updated_at,
    country: row.country,
    region: row.region as NormalizedNewsStory["region"],
    category: row.category as NewsCategory,
    subcategory: row.subcategory,
    entities: jsonArray(row.entities),
    keywords: jsonArray(row.keywords),
    assetClasses: jsonArray(row.asset_classes),
    symbols: jsonArray(row.symbols),
    urgency: Number(row.urgency),
    relevance: Number(row.relevance),
    priority: row.priority as NewsPriority,
    verification: row.verification as NewsVerification,
    sourceCount: Number(row.source_count),
    sources: parseSources(row.sources),
    clusterId: row.cluster_id,
    status: row.status as NormalizedNewsStory["status"],
    isBreaking: Number(row.is_breaking) === 1,
    contentHash: row.content_hash,
    dedupeKey: row.dedupe_key,
    attribution: row.attribution ?? "",
    license: row.license ?? "",
    isFixture: Number(row.is_fixture) === 1,
    impacts,
    saved: Number(row.saved ?? 0) === 1,
    clusterSize: Number(row.cluster_size ?? 1),
  };
}

function impactsForStoryIds(ids: string[]): Map<string, NewsImpact[]> {
  const map = new Map<string, NewsImpact[]>();
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = queryAll<ImpactRow>(
    `SELECT story_id, symbol, asset_class, direction, mechanism, confidence, is_interpretation
       FROM news_story_impacts WHERE story_id IN (${placeholders})`,
    ...ids,
  );
  for (const row of rows) {
    const list = map.get(row.story_id) ?? [];
    list.push({
      symbol: row.symbol,
      assetClass: row.asset_class,
      direction: row.direction as NewsImpact["direction"],
      mechanism: row.mechanism,
      confidence: Number(row.confidence),
      isInterpretation: true,
    });
    map.set(row.story_id, list);
  }
  return map;
}

export interface StoryListFilters {
  category?: NewsCategory;
  region?: string;
  provider?: string;
  priority?: NewsPriority;
  breakingOnly?: boolean;
  savedOnly?: boolean;
  search?: string;
  sinceHours?: number;
  limit?: number;
  offset?: number;
  sort?: "newest" | "published" | "priority" | "relevance";
}

export interface StoryListResult {
  stories: NewsStoryView[];
  total: number;
  limit: number;
  offset: number;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function listNewsStories(filters: StoryListFilters, userId: string | null): StoryListResult {
  const limit = clampInt(filters.limit ?? 60, 1, 200, 60);
  const offset = clampInt(filters.offset ?? 0, 0, 1_000_000, 0);
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.category && CATEGORY_ORDER.includes(filters.category)) {
    where.push("s.category = ?");
    params.push(filters.category);
  }
  if (filters.region && REGION_ORDER.includes(filters.region as (typeof REGION_ORDER)[number])) {
    where.push("s.region = ?");
    params.push(filters.region);
  }
  if (filters.provider && isNewsProviderKey(filters.provider)) {
    where.push("s.provider_key = ?");
    params.push(filters.provider);
  }
  if (filters.priority) {
    where.push("s.priority = ?");
    params.push(filters.priority);
  }
  if (filters.breakingOnly) where.push("s.is_breaking = 1");
  if (filters.savedOnly) where.push("sv.user_id IS NOT NULL");
  if (filters.search) {
    const like = `%${filters.search.trim().toLowerCase().slice(0, 80)}%`;
    where.push("(LOWER(s.title) LIKE ? OR LOWER(s.summary) LIKE ? OR LOWER(s.entities) LIKE ? OR LOWER(s.symbols) LIKE ?)");
    params.push(like, like, like, like);
  }
  if (filters.sinceHours && filters.sinceHours > 0) {
    const cutoff = new Date(Date.now() - Math.min(filters.sinceHours, 720) * 3_600_000).toISOString();
    where.push("s.received_at >= ?");
    params.push(cutoff);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sort =
    filters.sort === "published"
      ? "s.published_at DESC NULLS LAST, s.received_at DESC"
      : filters.sort === "priority"
        ? "s.urgency DESC, s.received_at DESC"
        : filters.sort === "relevance"
          ? "s.relevance DESC, s.received_at DESC"
          : "s.received_at DESC";

  const userParam = userId ?? "";
  const rows = queryAll<StoryRow>(
    `SELECT s.*,
            CASE WHEN sv.user_id IS NULL THEN 0 ELSE 1 END AS saved,
            (SELECT COUNT(*) FROM news_stories c WHERE c.cluster_id = s.cluster_id) AS cluster_size
       FROM news_stories s
       LEFT JOIN news_saved sv ON sv.story_id = s.id AND sv.user_id = ?
       ${whereSql}
       ORDER BY ${sort}
       LIMIT ? OFFSET ?`,
    userParam,
    ...params,
    limit,
    offset,
  );
  const totalRow = queryOne<{ count: number | bigint }>(
    `SELECT COUNT(*) AS count FROM news_stories s
       LEFT JOIN news_saved sv ON sv.story_id = s.id AND sv.user_id = ?
       ${whereSql}`,
    userParam,
    ...params,
  );
  const impacts = impactsForStoryIds(rows.map((row) => row.id));
  return {
    stories: rows.map((row) => rowToStory(row, impacts.get(row.id) ?? [])),
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  };
}

export function getNewsStory(id: string, userId: string | null): NewsStoryView | null {
  const row = queryOne<StoryRow>(
    `SELECT s.*,
            CASE WHEN sv.user_id IS NULL THEN 0 ELSE 1 END AS saved,
            (SELECT COUNT(*) FROM news_stories c WHERE c.cluster_id = s.cluster_id) AS cluster_size
       FROM news_stories s
       LEFT JOIN news_saved sv ON sv.story_id = s.id AND sv.user_id = ?
       WHERE s.id = ?`,
    userId ?? "",
    id,
  );
  if (!row) return null;
  return rowToStory(row, impactsForStoryIds([row.id]).get(row.id) ?? []);
}

export function storiesUpdatedSince(
  sinceReceived: string,
  sinceUpdated: string,
  userId: string | null,
  limit = 100,
): NewsStoryView[] {
  const rows = queryAll<StoryRow>(
    `SELECT s.*,
            CASE WHEN sv.user_id IS NULL THEN 0 ELSE 1 END AS saved,
            (SELECT COUNT(*) FROM news_stories c WHERE c.cluster_id = s.cluster_id) AS cluster_size
       FROM news_stories s
       LEFT JOIN news_saved sv ON sv.story_id = s.id AND sv.user_id = ?
       WHERE s.received_at > ? OR s.updated_at > ?
       ORDER BY s.updated_at ASC LIMIT ?`,
    userId ?? "",
    sinceReceived,
    sinceUpdated,
    clampInt(limit, 1, 200, 100),
  );
  const impacts = impactsForStoryIds(rows.map((row) => row.id));
  return rows.map((row) => rowToStory(row, impacts.get(row.id) ?? []));
}

export function getClusterStories(clusterId: string, excludeId: string, userId: string | null, limit = 12): NewsStoryView[] {
  const rows = queryAll<StoryRow>(
    `SELECT s.*,
            CASE WHEN sv.user_id IS NULL THEN 0 ELSE 1 END AS saved,
            (SELECT COUNT(*) FROM news_stories c WHERE c.cluster_id = s.cluster_id) AS cluster_size
       FROM news_stories s
       LEFT JOIN news_saved sv ON sv.story_id = s.id AND sv.user_id = ?
       WHERE s.cluster_id = ? AND s.id <> ?
       ORDER BY s.received_at DESC LIMIT ?`,
    userId ?? "",
    clusterId,
    excludeId,
    clampInt(limit, 1, 30, 12),
  );
  const impacts = impactsForStoryIds(rows.map((row) => row.id));
  return rows.map((row) => rowToStory(row, impacts.get(row.id) ?? []));
}

export function newsCounts(userId: string | null): {
  total: number;
  last24h: number;
  breaking: number;
  saved: number;
} {
  const total = queryOne<{ count: number | bigint }>("SELECT COUNT(*) AS count FROM news_stories");
  const last24h = queryOne<{ count: number | bigint }>(
    "SELECT COUNT(*) AS count FROM news_stories WHERE received_at >= ?",
    new Date(Date.now() - 24 * 3_600_000).toISOString(),
  );
  const breaking = queryOne<{ count: number | bigint }>(
    "SELECT COUNT(*) AS count FROM news_stories WHERE is_breaking = 1 AND received_at >= ?",
    new Date(Date.now() - 48 * 3_600_000).toISOString(),
  );
  const saved = userId
    ? queryOne<{ count: number | bigint }>("SELECT COUNT(*) AS count FROM news_saved WHERE user_id = ?", userId)
    : { count: 0 };
  return {
    total: Number(total?.count ?? 0),
    last24h: Number(last24h?.count ?? 0),
    breaking: Number(breaking?.count ?? 0),
    saved: Number(saved?.count ?? 0),
  };
}

export function newsSourceFacets(): { key: string; name: string; count: number }[] {
  return queryAll<{ key: string; name: string; count: number | bigint }>(
    `SELECT provider_key AS key, source_name AS name, COUNT(*) AS count
       FROM news_stories GROUP BY provider_key, source_name ORDER BY count DESC`,
  ).map((row) => ({ key: row.key, name: row.name, count: Number(row.count) }));
}

/* ------------------------------- ingestion ------------------------------- */

export interface IngestStoryResult {
  action: "inserted" | "merged" | "clustered" | "duplicate" | "skipped";
  storyId: string | null;
}

export function processIncomingStory(
  item: ParsedNewsItem,
  provider: NewsProviderDefinition,
  extraKeywords: Partial<Record<NewsCategory, string[]>> = {},
  now = new Date(),
): IngestStoryResult {
  const candidate = buildNormalizedStory({ item, provider, now, extraKeywords });

  const existingByKey = queryOne<StoryRow>(
    "SELECT * FROM news_stories WHERE provider_key = ? AND provider_item_id = ? LIMIT 1",
    provider.key,
    item.providerItemId,
  );
  if (existingByKey) return { action: "duplicate", storyId: existingByKey.id };

  const cutoff = new Date(now.getTime() - 72 * 3_600_000).toISOString();
  const recent = queryAll<StoryRow>(
    "SELECT * FROM news_stories WHERE received_at >= ? ORDER BY received_at DESC LIMIT 400",
    cutoff,
  );

  let best: StoryRow | null = null;
  let bestKind: "duplicate" | "related" | "new" = "new";
  let bestSimilarity = 0;

  if (candidate.canonicalUrl) {
    const urlMatch = recent.find((row) => row.canonical_url === candidate.canonicalUrl);
    if (urlMatch) {
      best = urlMatch;
      bestKind = "duplicate";
      bestSimilarity = 1;
    }
  }

  if (!best) {
    for (const row of recent) {
      const result = compareReports(
        {
          title: candidate.title,
          canonicalUrl: candidate.canonicalUrl,
          contentHash: candidate.contentHash,
          publishedAt: candidate.publishedAt,
          receivedAt: candidate.receivedAt,
        },
        {
          title: row.title,
          canonicalUrl: row.canonical_url,
          contentHash: row.content_hash,
          publishedAt: row.published_at,
          receivedAt: row.received_at,
        },
      );
      if (result.kind === "duplicate") {
        best = row;
        bestKind = "duplicate";
        bestSimilarity = result.similarity;
        break;
      }
      if (result.kind === "related" && result.similarity > bestSimilarity) {
        best = row;
        bestKind = "related";
        bestSimilarity = result.similarity;
      }
    }
  }

  if (best && bestKind === "duplicate") {
    return mergeIntoExisting(best, item, provider, now);
  }

  if (best && bestKind === "related") {
    candidate.clusterId = best.cluster_id || best.id;
    candidate.status = "developing";
  }

  try {
    insertStory(candidate);
    return { action: bestKind === "related" ? "clustered" : "inserted", storyId: candidate.id };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const row = queryOne<StoryRow>(
        "SELECT * FROM news_stories WHERE provider_key = ? AND provider_item_id = ? LIMIT 1",
        provider.key,
        item.providerItemId,
      );
      return { action: "duplicate", storyId: row?.id ?? null };
    }
    throw err;
  }
}

function mergeIntoExisting(
  row: StoryRow,
  item: ParsedNewsItem,
  provider: NewsProviderDefinition,
  now: Date,
): IngestStoryResult {
  const existing = rowToStory(row);
  const merge: DuplicateMerge = mergeDuplicateStory(existing, item, provider, now);
  if (!merge.changed) return { action: "duplicate", storyId: existing.id };

  execute(
    `UPDATE news_stories SET
       sources = ?, source_count = ?, verification = ?, updated_at = ?, status = ?,
       summary = ?, is_breaking = ?, priority = ?, urgency = ?, relevance = ?,
       symbols = ?, asset_classes = ?
     WHERE id = ?`,
    JSON.stringify(merge.patch.sources),
    merge.patch.sourceCount,
    merge.patch.verification,
    merge.patch.updatedAt,
    merge.patch.status,
    merge.patch.summary,
    merge.patch.isBreaking ? 1 : 0,
    merge.patch.priority,
    merge.patch.urgency,
    merge.patch.relevance,
    JSON.stringify(merge.patch.symbols),
    JSON.stringify(merge.patch.assetClasses),
    existing.id,
  );
  replaceImpacts(existing.id, merge.patch.impacts);
  return { action: "merged", storyId: existing.id };
}

function insertStory(story: NormalizedNewsStory): void {
  execute(
    `INSERT INTO news_stories (
       id, provider_key, provider_item_id, source_name, source_homepage, url, canonical_url,
       title, summary, published_at, published_known, source_updated_at, received_at,
       ingested_at, updated_at, country, region, category, subcategory, entities, keywords,
       asset_classes, symbols, urgency, relevance, priority, verification, source_count,
       sources, cluster_id, status, is_breaking, content_hash, dedupe_key, attribution, license, is_fixture
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    story.id,
    story.providerKey,
    story.providerItemId,
    story.sourceName,
    story.sourceHomepage,
    story.url,
    story.canonicalUrl,
    story.title,
    story.summary,
    story.publishedAt,
    story.publishedKnown ? 1 : 0,
    story.sourceUpdatedAt,
    story.receivedAt,
    story.ingestedAt,
    story.updatedAt,
    story.country,
    story.region,
    story.category,
    story.subcategory,
    JSON.stringify(story.entities),
    JSON.stringify(story.keywords),
    JSON.stringify(story.assetClasses),
    JSON.stringify(story.symbols),
    story.urgency,
    story.relevance,
    story.priority,
    story.verification,
    story.sourceCount,
    JSON.stringify(story.sources),
    story.clusterId,
    story.status,
    story.isBreaking ? 1 : 0,
    story.contentHash,
    story.dedupeKey,
    story.attribution,
    story.license,
    story.isFixture ? 1 : 0,
  );
  insertImpacts(story.id, story.impacts);
}

function insertImpacts(storyId: string, impacts: NewsImpact[]): void {
  for (const impact of impacts) {
    execute(
      `INSERT INTO news_story_impacts (story_id, symbol, asset_class, direction, mechanism, confidence, is_interpretation)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(story_id, symbol) DO NOTHING`,
      storyId,
      impact.symbol,
      impact.assetClass,
      impact.direction,
      impact.mechanism,
      impact.confidence,
    );
  }
}

function replaceImpacts(storyId: string, impacts: NewsImpact[]): void {
  execute("DELETE FROM news_story_impacts WHERE story_id = ?", storyId);
  insertImpacts(storyId, impacts);
}

function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed|duplicate key value violates unique constraint|unique violation/i.test(message);
}

/** Recompute a story from its existing source data (used for admin repair). */
export function rebuildStoryFromRow(storyId: string): boolean {
  const row = queryOne<StoryRow>("SELECT * FROM news_stories WHERE id = ?", storyId);
  if (!row) return false;
  const existing = rowToStory(row);
  const canonical = canonicalizeUrl(existing.url, existing.sourceHomepage ?? undefined);
  const updated = {
    ...existing,
    canonicalUrl: canonical,
    contentHash: contentHashFor(existing.title, existing.summary),
    dedupeKey: dedupeKeyFor(existing.providerKey, existing.providerItemId),
  };
  execute(
    `UPDATE news_stories SET canonical_url = ?, content_hash = ?, dedupe_key = ? WHERE id = ?`,
    updated.canonicalUrl,
    updated.contentHash,
    updated.dedupeKey,
    storyId,
  );
  return true;
}

/* -------------------------------- sources -------------------------------- */

export interface NewsSourceHealth {
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

export function listNewsSourceHealth(): NewsSourceHealth[] {
  const rows = queryAll<SourceRow>("SELECT * FROM news_sources");
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const now = Date.now();
  return NEWS_PROVIDERS.map((provider) => {
    const row = byKey.get(provider.key);
    const enabled = Number(row?.enabled ?? 0) === 1 && Boolean(provider.endpoint);
    const interval = Number(row?.interval_seconds ?? provider.intervalSeconds);
    const lastSuccess = row?.last_success_at ?? null;
    const failures = Number(row?.consecutive_failures ?? 0);
    let status: NewsSourceHealth["status"] = "pending";
    if (!provider.endpoint) status = "unavailable";
    else if (!enabled) status = "disabled";
    else if (failures > 0 && row?.last_error) status = "error";
    else if (lastSuccess) {
      const age = now - Date.parse(lastSuccess);
      status = Number.isFinite(age) && age <= Math.max(3 * interval * 1000, 60 * 60_000) ? "ok" : "stale";
    }
    return {
      key: provider.key,
      name: provider.name,
      kind: provider.kind,
      homepage: provider.homepage,
      endpoint: provider.endpoint,
      enabled,
      official: provider.official,
      attribution: provider.attribution,
      license: provider.license,
      intervalSeconds: interval,
      regionHint: (row?.region_hint ?? provider.regionHint) || null,
      categoryHint: (row?.category_hint ?? provider.categoryHint) || null,
      lastPolledAt: row?.last_polled_at ?? null,
      lastSuccessAt: lastSuccess,
      lastError: row?.last_error ?? null,
      consecutiveFailures: failures,
      nextAttemptAt: row?.next_attempt_at ?? null,
      itemsTotal: Number(row?.items_total ?? 0),
      lastLatencyMs: row?.last_latency_ms == null ? null : Number(row.last_latency_ms),
      lastItemCount: Number(row?.last_item_count ?? 0),
      unavailableReason: provider.unavailableReason ?? row?.unavailable_reason ?? null,
      status,
    };
  });
}

export interface DueSource {
  key: string;
  intervalSeconds: number;
  timeoutMs: number;
  etag: string | null;
  lastModified: string | null;
}

export function claimDueNewsSources(limit: number, now = new Date()): DueSource[] {
  const enabled = queryAll<SourceRow>(
    `SELECT * FROM news_sources
      WHERE enabled = 1 AND endpoint IS NOT NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY COALESCE(last_polled_at, '') ASC
      LIMIT ?`,
    now.toISOString(),
    Math.max(1, Math.min(limit, 6)),
  );
  const claimed: DueSource[] = [];
  for (const row of enabled) {
    const provider = NEWS_PROVIDERS.find((entry) => entry.key === row.key);
    if (!provider?.endpoint) continue;
    // Best-effort claim so overlapping requests do not fetch the same feed twice.
    const result = getDb()
      .prepare("UPDATE news_sources SET next_attempt_at = ? WHERE key = ? AND enabled = 1 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)")
      .run(new Date(now.getTime() + 60_000).toISOString(), row.key, now.toISOString());
    if (Number(result.changes) === 0) continue;
    claimed.push({
      key: row.key,
      intervalSeconds: Number(row.interval_seconds ?? provider.intervalSeconds),
      timeoutMs: provider.timeoutMs,
      etag: row.etag,
      lastModified: row.last_modified,
    });
  }
  return claimed;
}

export function markSourceSuccess(input: {
  key: string;
  latencyMs: number;
  itemCount: number;
  nextAttemptAt: string;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}): void {
  const now = new Date().toISOString();
  execute(
    `UPDATE news_sources SET
       last_polled_at = ?, last_success_at = ?, last_error = NULL, consecutive_failures = 0,
       next_attempt_at = ?, items_total = items_total + ?, last_latency_ms = ?,
       last_item_count = ?, etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified)
     WHERE key = ?`,
    now,
    now,
    input.nextAttemptAt,
    input.notModified ? 0 : input.itemCount,
    Math.round(input.latencyMs),
    input.notModified ? 0 : input.itemCount,
    input.etag,
    input.lastModified,
    input.key,
  );
}

export function markSourceFailure(key: string, error: string, nextAttemptAt: string): void {
  execute(
    `UPDATE news_sources SET
       last_polled_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1,
       next_attempt_at = ?
     WHERE key = ?`,
    new Date().toISOString(),
    error.slice(0, 280),
    nextAttemptAt,
    key,
  );
}

export function getSourceRow(key: string): SourceRow | undefined {
  return queryOne<SourceRow>("SELECT * FROM news_sources WHERE key = ?", key);
}

export function setSourceEnabled(key: string, enabled: boolean): void {
  execute("UPDATE news_sources SET enabled = ?, next_attempt_at = NULL WHERE key = ?", enabled ? 1 : 0, key);
}

export function setSourceInterval(key: string, seconds: number): void {
  execute("UPDATE news_sources SET interval_seconds = ? WHERE key = ?", seconds, key);
}

/* ------------------------------- settings ------------------------------- */

function readSetting(key: string): string | null {
  return queryOne<{ value: string }>("SELECT value FROM news_settings WHERE key = ?", key)?.value ?? null;
}

export function getNewsSettings(): NewsSettings {
  const retention = Number(readSetting("retention_days"));
  const collection = readSetting("collection_enabled");
  let customKeywords: NewsSettings["customKeywords"] = {};
  try {
    const raw = readSetting("custom_keywords");
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") customKeywords = parsed as NewsSettings["customKeywords"];
    }
  } catch {
    customKeywords = {};
  }
  return {
    retentionDays: Number.isFinite(retention) && retention >= 7 && retention <= 365 ? retention : DEFAULT_NEWS_SETTINGS.retentionDays,
    collectionEnabled: collection === null ? DEFAULT_NEWS_SETTINGS.collectionEnabled : collection === "1",
    customKeywords,
    lastPruneAt: readSetting("last_prune_at"),
  };
}

export function writeNewsSetting(key: string, value: string): void {
  execute(
    `INSERT INTO news_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    value,
    new Date().toISOString(),
  );
}

export function saveNewsSettings(settings: Partial<NewsSettings>): void {
  if (settings.retentionDays !== undefined) writeNewsSetting("retention_days", String(settings.retentionDays));
  if (settings.collectionEnabled !== undefined) writeNewsSetting("collection_enabled", settings.collectionEnabled ? "1" : "0");
  if (settings.customKeywords !== undefined) writeNewsSetting("custom_keywords", JSON.stringify(settings.customKeywords));
  if (settings.lastPruneAt) writeNewsSetting("last_prune_at", settings.lastPruneAt);
}

/* -------------------------------- saved --------------------------------- */

export function setStorySaved(userId: string, storyId: string, saved: boolean): boolean {
  const exists = Boolean(queryOne<{ id: string }>("SELECT id FROM news_stories WHERE id = ?", storyId));
  if (!exists) return false;
  if (saved) {
    execute(
      "INSERT INTO news_saved (user_id, story_id, saved_at) VALUES (?, ?, ?) ON CONFLICT(user_id, story_id) DO NOTHING",
      userId,
      storyId,
      new Date().toISOString(),
    );
  } else {
    execute("DELETE FROM news_saved WHERE user_id = ? AND story_id = ?", userId, storyId);
  }
  return true;
}

/* ------------------------------ maintenance ----------------------------- */

export function recordIngestRun(run: {
  startedAt: string;
  finishedAt: string;
  providersTried: number;
  itemsSeen: number;
  inserted: number;
  merged: number;
  clustered: number;
  errors: number;
  detail: unknown[];
}): void {
  execute(
    `INSERT INTO news_ingest_runs
       (started_at, finished_at, providers_tried, items_seen, inserted, merged, clustered, errors, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    run.startedAt,
    run.finishedAt,
    run.providersTried,
    run.itemsSeen,
    run.inserted,
    run.merged,
    run.clustered,
    run.errors,
    JSON.stringify(run.detail),
  );
  const old = queryAll<{ id: number | bigint }>(
    "SELECT id FROM news_ingest_runs ORDER BY id DESC LIMIT 50 OFFSET 40",
  );
  if (old.length) {
    const placeholders = old.map(() => "?").join(",");
    execute(`DELETE FROM news_ingest_runs WHERE id IN (${placeholders})`, ...old.map((row) => row.id));
  }
}

export interface IngestRunView {
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

export function lastIngestRun(): IngestRunView | null {
  const row = queryOne<{
    id: number | bigint;
    started_at: string;
    finished_at: string;
    providers_tried: number | bigint;
    items_seen: number | bigint;
    inserted: number | bigint;
    merged: number | bigint;
    clustered: number | bigint;
    errors: number | bigint;
    detail: string;
  }>("SELECT * FROM news_ingest_runs ORDER BY id DESC LIMIT 1");
  if (!row) return null;
  let detail: unknown = [];
  try {
    detail = JSON.parse(row.detail);
  } catch {
    detail = [];
  }
  return {
    id: Number(row.id),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    providersTried: Number(row.providers_tried),
    itemsSeen: Number(row.items_seen),
    inserted: Number(row.inserted),
    merged: Number(row.merged),
    clustered: Number(row.clustered),
    errors: Number(row.errors),
    detail,
  };
}

export function pruneNewsStories(retentionDays: number): { removed: number } {
  const days = Math.max(7, Math.min(365, Math.trunc(retentionDays)));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = queryAll<{ id: string }>("SELECT id FROM news_stories WHERE updated_at < ?", cutoff);
  if (!rows.length) return { removed: 0 };
  const ids = rows.map((row) => row.id);
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80);
    const placeholders = chunk.map(() => "?").join(",");
    execute(`DELETE FROM news_story_impacts WHERE story_id IN (${placeholders})`, ...chunk);
    execute(`DELETE FROM news_saved WHERE story_id IN (${placeholders})`, ...chunk);
    execute(`DELETE FROM news_stories WHERE id IN (${placeholders})`, ...chunk);
  }
  return { removed: ids.length };
}
