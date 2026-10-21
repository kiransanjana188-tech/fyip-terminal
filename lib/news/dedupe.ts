/**
 * Deterministic dedupe/clustering helpers. No network, no hidden state.
 *
 * - URL identity is authoritative for the same article.
 * - Near-identical headlines are merged as the same report.
 * - Related headlines are clustered as the same developing event without
 *   suppressing distinct details.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "cmpid",
  "mod",
  "nl",
  "src",
]);

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "as", "at", "by", "for",
  "from", "in", "into", "of", "on", "onto", "to", "with", "without", "over", "under", "after",
  "before", "about", "amid", "via", "is", "are", "was", "were", "be", "been", "being", "it",
  "its", "this", "that", "these", "those", "he", "she", "they", "we", "you", "i", "his", "her",
  "their", "our", "your", "has", "have", "had", "will", "would", "could", "should", "may",
  "might", "can", "says", "said", "say", "new", "news", "report", "reports", "update", "updates",
  "live", "today", "now", "just", "breaking", "urgent", "exclusive", "latest",
]);

export function canonicalizeUrl(raw: string | null | undefined, base?: string): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  const entries = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()));
  entries.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [key, value] of entries) url.searchParams.append(key, value);
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&[a-z]+;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function jaccardSimilarity(a: string, b: string): number {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export interface DedupeCandidate {
  title: string;
  canonicalUrl: string | null;
  contentHash: string;
  publishedAt: string | null;
  receivedAt: string;
}

export interface DedupeResult {
  kind: "duplicate" | "related" | "new";
  /** 0..1 similarity used for transparency/logging. */
  similarity: number;
  reason: "url" | "hash" | "headline" | "event" | "none";
}

/**
 * Compare an incoming report with a recent persisted story.
 *
 * `recent` is expected to be scoped by the caller (e.g. last 72 hours). The
 * function itself does not enforce time windows so it stays testable.
 */
export function compareReports(incoming: DedupeCandidate, existing: DedupeCandidate): DedupeResult {
  if (incoming.canonicalUrl && existing.canonicalUrl && incoming.canonicalUrl === existing.canonicalUrl) {
    return { kind: "duplicate", similarity: 1, reason: "url" };
  }
  if (incoming.contentHash && existing.contentHash && incoming.contentHash === existing.contentHash) {
    return { kind: "duplicate", similarity: 1, reason: "hash" };
  }

  const similarity = jaccardSimilarity(incoming.title, existing.title);
  const sameTitle = similarity >= 0.86;
  if (sameTitle) return { kind: "duplicate", similarity, reason: "headline" };

  const gapHours = hoursBetween(existing.publishedAt ?? existing.receivedAt, incoming.publishedAt ?? incoming.receivedAt);
  const recentEnough = Number.isFinite(gapHours) && Math.abs(gapHours) <= 36;
  if (recentEnough && similarity >= 0.5) {
    return { kind: "related", similarity, reason: "event" };
  }

  return { kind: "new", similarity, reason: "none" };
}

export function hoursBetween(isoA: string, isoB: string): number {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return (b - a) / 3_600_000;
}
