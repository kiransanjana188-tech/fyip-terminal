import { isPostgres, queryOne } from "@/lib/db";
import { getNewsProvider, isAllowedNewsEndpoint, parseProviderFeed, providerRequestHeaders } from "./providers";
import { cleanErrorMessage, retryAfterFromHeaders, retryDelayMs } from "./pipeline";
import { isAllowedArticleUrl } from "./parse";
import {
  claimDueNewsSources,
  getNewsSettings,
  lastIngestRun,
  markSourceFailure,
  markSourceSuccess,
  processIncomingStory,
  pruneNewsStories,
  recordIngestRun,
  saveNewsSettings,
} from "./store";

/**
 * Serverless-aware collection.
 *
 * Netlify has no in-process scheduler here (and FYIP deliberately does not
 * require dashboard cron configuration). Collection runs while a news client
 * is connected / requests a refresh, gated per-source by `next_attempt_at` and
 * protected by a process-local in-flight promise. On a workstation the API
 * bootstrap also runs a 60s interval.
 */

export interface CollectSourceDetail {
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

export interface CollectSummary {
  startedAt: string;
  finishedAt: string;
  providersTried: number;
  itemsSeen: number;
  inserted: number;
  merged: number;
  clustered: number;
  errors: number;
  budgetExhausted: boolean;
  details: CollectSourceDetail[];
}

declare global {
  // eslint-disable-next-line no-var
  var __fyipNewsCollect: Promise<CollectSummary> | undefined;
}

const MAX_ARTICLES_PER_FEED = 80;

export async function collectDueNewsSources(options: {
  maxSources?: number;
  budgetMs?: number;
  triggeredBy?: string;
} = {}): Promise<CollectSummary> {
  const existing = globalThis.__fyipNewsCollect;
  if (existing) return existing;

  const promise = runCollection(options).finally(() => {
    globalThis.__fyipNewsCollect = undefined;
  });
  globalThis.__fyipNewsCollect = promise;
  return promise;
}

async function runCollection(options: {
  maxSources?: number;
  budgetMs?: number;
  triggeredBy?: string;
}): Promise<CollectSummary> {
  const startedAt = new Date().toISOString();
  const settings = getNewsSettings();
  const maxSources = Math.max(1, Math.min(options.maxSources ?? (isPostgres() ? 2 : 4), 6));
  const budgetMs = Math.max(2_000, Math.min(options.budgetMs ?? (isPostgres() ? 8_000 : 20_000), 25_000));
  const deadline = Date.now() + budgetMs;
  const details: CollectSourceDetail[] = [];
  let budgetExhausted = false;

  if (!settings.collectionEnabled) {
    return finish(startedAt, [], false);
  }

  const due = claimDueNewsSources(maxSources);
  for (const source of due) {
    const remaining = deadline - Date.now();
    if (remaining < 900) {
      budgetExhausted = true;
      break;
    }
    const provider = getNewsProvider(source.key);
    if (!provider || !provider.endpoint || !isAllowedNewsEndpoint(provider.endpoint)) {
      details.push({
        key: source.key,
        status: "error",
        items: 0,
        inserted: 0,
        merged: 0,
        clustered: 0,
        duplicates: 0,
        latencyMs: 0,
        error: "Provider endpoint is not registered or not allowlisted.",
      });
      markSourceFailure(source.key, "Endpoint not allowlisted", new Date(Date.now() + 6 * 3_600_000).toISOString());
      continue;
    }

    const started = Date.now();
    const timeoutMs = Math.max(1_000, Math.min(provider.timeoutMs, remaining - 400));
    try {
      const response = await fetchFeed(provider.endpoint, provider.key, timeoutMs, source.etag, source.lastModified);
      const latencyMs = Date.now() - started;
      // Redirects are followed by fetch, so re-check the final URL against the
      // exact-host allowlist before reading any body (SSRF guard).
      if (!isAllowedNewsEndpoint(response.url)) {
        throw new Error("Feed redirected outside the approved host allowlist.");
      }

      if (response.status === 304) {
        markSourceSuccess({
          key: provider.key,
          latencyMs,
          itemCount: 0,
          nextAttemptAt: new Date(Date.now() + source.intervalSeconds * 1000).toISOString(),
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          notModified: true,
        });
        details.push({ key: provider.key, status: "not-modified", items: 0, inserted: 0, merged: 0, clustered: 0, duplicates: 0, latencyMs });
        continue;
      }

      if (!response.ok) {
        const retryAfter = retryAfterFromHeaders(response.headers);
        const error = `HTTP ${response.status}${response.status === 429 ? " rate limited" : ""}`;
        markSourceFailure(
          provider.key,
          error,
          new Date(Date.now() + retryDelayMs(Number(getFailures(provider.key)) + 1, source.intervalSeconds * 1000, retryAfter)).toISOString(),
        );
        details.push({
          key: provider.key,
          status: "error",
          items: 0,
          inserted: 0,
          merged: 0,
          clustered: 0,
          duplicates: 0,
          latencyMs,
          error,
        });
        continue;
      }

      const body = await response.text();
      const parsed = parseProviderFeed(provider, body);
      const items = parsed.items.slice(0, MAX_ARTICLES_PER_FEED);
      let inserted = 0;
      let merged = 0;
      let clustered = 0;
      let duplicates = 0;
      let skipped = 0;

      for (const item of items) {
        if (item.url && !isAllowedArticleUrl(item.url)) {
          skipped += 1;
          continue;
        }
        try {
          const result = processIncomingStory(item, provider, settings.customKeywords);
          if (result.action === "inserted") inserted += 1;
          else if (result.action === "merged") merged += 1;
          else if (result.action === "clustered") clustered += 1;
          else if (result.action === "duplicate") duplicates += 1;
          else skipped += 1;
        } catch (error) {
          skipped += 1;
          console.error(`[fyip:news] store failed for ${provider.key}:`, cleanErrorMessage(error));
        }
      }

      markSourceSuccess({
        key: provider.key,
        latencyMs,
        itemCount: items.length - skipped,
        nextAttemptAt: new Date(Date.now() + source.intervalSeconds * 1000).toISOString(),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
        notModified: false,
      });
      details.push({
        key: provider.key,
        status: "ok",
        items: items.length,
        inserted,
        merged,
        clustered,
        duplicates,
        latencyMs,
      });
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = cleanErrorMessage(error);
      const failures = Number(getFailures(provider.key)) + 1;
      markSourceFailure(
        provider.key,
        message,
        new Date(Date.now() + retryDelayMs(failures, source.intervalSeconds * 1000)).toISOString(),
      );
      details.push({
        key: provider.key,
        status: "error",
        items: 0,
        inserted: 0,
        merged: 0,
        clustered: 0,
        duplicates: 0,
        latencyMs,
        error: message,
      });
    }
  }

  const latestSettings = getNewsSettings();
  maybePrune(latestSettings.retentionDays, latestSettings.lastPruneAt);
  return finish(startedAt, details, budgetExhausted, options.triggeredBy);
}

function finish(
  startedAt: string,
  details: CollectSourceDetail[],
  budgetExhausted: boolean,
  triggeredBy = "request",
): CollectSummary {
  const summary: CollectSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    providersTried: details.filter((detail) => detail.status !== "skipped").length,
    itemsSeen: details.reduce((sum, detail) => sum + detail.items, 0),
    inserted: details.reduce((sum, detail) => sum + detail.inserted, 0),
    merged: details.reduce((sum, detail) => sum + detail.merged, 0),
    clustered: details.reduce((sum, detail) => sum + detail.clustered, 0),
    errors: details.filter((detail) => detail.status === "error").length,
    budgetExhausted,
    details,
  };
  if (summary.providersTried > 0) {
    recordIngestRun({
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      providersTried: summary.providersTried,
      itemsSeen: summary.itemsSeen,
      inserted: summary.inserted,
      merged: summary.merged,
      clustered: summary.clustered,
      errors: summary.errors,
      detail: [{ triggeredBy, budgetExhausted, sources: details }],
    });
  }
  return summary;
}

async function fetchFeed(
  url: string,
  providerKey: string,
  timeoutMs: number,
  etag: string | null,
  lastModified: string | null,
): Promise<Response> {
  const provider = getNewsProvider(providerKey);
  if (!provider) throw new Error("Unknown provider");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = providerRequestHeaders(provider);
    if (etag) headers["If-None-Match"] = etag;
    if (lastModified) headers["If-Modified-Since"] = lastModified;
    return await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getFailures(key: string): number {
  return Number(
    queryOne<{ consecutive_failures: number | bigint }>(
      "SELECT consecutive_failures FROM news_sources WHERE key = ?",
      key,
    )?.consecutive_failures ?? 0,
  );
}

function maybePrune(retentionDays: number, lastPruneAt: string | null): void {
  const last = lastPruneAt ? Date.parse(lastPruneAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < 24 * 3_600_000) return;
  try {
    pruneNewsStories(retentionDays);
    saveNewsSettings({ lastPruneAt: new Date().toISOString() });
  } catch (error) {
    console.error("[fyip:news] prune failed:", cleanErrorMessage(error));
  }
}

/** Start the workstation-only background collector. No-op on Netlify. */
export function ensureNewsCollector(): void {
  if (isPostgres()) return;
  if (process.env.FYIP_NEWS_COLLECTOR === "off") return;
  const globalRef = globalThis as { __fyipNewsCollectorStarted?: boolean };
  if (globalRef.__fyipNewsCollectorStarted) return;
  globalRef.__fyipNewsCollectorStarted = true;
  const tick = () => {
    void collectDueNewsSources({ maxSources: 3, triggeredBy: "interval" }).catch((error) => {
      console.error("[fyip:news] collector error:", cleanErrorMessage(error));
    });
  };
  setTimeout(tick, 5_000);
  setInterval(tick, 60_000).unref?.();
}

export function lastNewsCollectionAt(): string | null {
  return lastIngestRun()?.finishedAt ?? null;
}
