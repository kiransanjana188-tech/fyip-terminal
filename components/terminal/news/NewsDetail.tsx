"use client";

import { useEffect, useState } from "react";
import { apiPost, ApiError } from "@/lib/client/api";
import type {
  NewsAiStatusDTO,
  NewsSourceHealthDTO,
  NewsStoryDTO,
  NewsSummarizeDTO,
} from "@/lib/client/types";
import { ago, cn, dateTime } from "@/lib/utils";
import { CATEGORY_LABEL, REGION_LABEL } from "@/lib/news/taxonomy";
import { DirectionBadge, VerificationBadge } from "./NewsBadges";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";

function lagLabel(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const seconds = Math.max(0, Math.round((b - a) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function domain(url: string | null): string {
  if (!url) return "no direct link";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

export function NewsDetail({
  story,
  related,
  sources,
  ai,
  loading,
  error,
  canSave,
  onSave,
  onSelect,
}: {
  story: NewsStoryDTO | null;
  related: NewsStoryDTO[];
  sources: NewsSourceHealthDTO[];
  ai: NewsAiStatusDTO | null;
  loading: boolean;
  error: string | null;
  canSave: boolean;
  onSave: (story: NewsStoryDTO) => void;
  onSelect: (id: string) => void;
}) {
  const [aiResult, setAiResult] = useState<NewsSummarizeDTO | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    setAiResult(null);
    setAiError(null);
    setAiBusy(false);
  }, [story?.id]);

  async function runSummary() {
    if (!story) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await apiPost<NewsSummarizeDTO>("/news/summarize", { storyId: story.id });
      setAiResult(result);
      if (!result.enabled) setAiError(result.reason ?? "AI summarization is not available.");
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "AI request failed.");
    } finally {
      setAiBusy(false);
    }
  }

  if (loading) return <Loading label="Loading story" />;
  if (error) return <ErrorState message={error} />;
  if (!story) {
    return (
      <EmptyState
        title="No story selected"
        hint="Select a headline from the wire to inspect timestamps, verification, attribution and potential transmission channels."
      />
    );
  }

  const ingestionLag = lagLabel(story.receivedAt, story.ingestedAt);
  const sourceLag = story.publishedKnown ? lagLabel(story.publishedAt, story.receivedAt) : null;
  const providerHealth = sources.find((source) => source.key === story.providerKey);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-2.5 py-1.5">
        <span className="font-mono text-2xs uppercase tracking-widest text-amber">Story Context</span>
        {canSave && (
          <button
            onClick={() => onSave(story)}
            className={cn(
              "ml-auto border px-1.5 py-[1px] font-mono text-3xs uppercase tracking-wider",
              story.saved
                ? "border-amber/50 bg-amber/10 text-amber"
                : "border-line-2 bg-panel text-ink-faint hover:border-amber hover:text-amber",
            )}
            title={story.saved ? "Remove from saved headlines" : "Save headline"}
          >
            {story.saved ? "SAVED" : "SAVE"}
          </button>
        )}
      </div>

      <div className="space-y-3 overflow-y-auto p-3">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            <VerificationBadge value={story.verification} />
            <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">
              {story.priority}
            </span>
            {story.isBreaking && (
              <span className="font-mono text-3xs uppercase tracking-wider text-down">BREAKING</span>
            )}
            {story.clusterSize > 1 && (
              <span className="font-mono text-3xs uppercase tracking-wider text-info">
                {story.clusterSize} REPORTS IN CLUSTER
              </span>
            )}
            {story.status !== "new" && (
              <span className="font-mono text-3xs uppercase tracking-wider text-amber">{story.status}</span>
            )}
          </div>
          <h2 className="text-sm font-semibold leading-snug text-ink">{story.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
            <span>{CATEGORY_LABEL[story.category as keyof typeof CATEGORY_LABEL] ?? story.category}</span>
            <span className="text-line-2">/</span>
            <span>{REGION_LABEL[story.region as keyof typeof REGION_LABEL] ?? story.region}</span>
            <span className="text-line-2">/</span>
            <span className="text-ink-dim">{story.sourceName}</span>
          </div>
          {story.url && (
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block font-mono text-3xs uppercase tracking-wider text-info hover:text-amber"
            >
              Open original ({domain(story.url)}) -&gt;
            </a>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px border border-line bg-line">
          <TimeCell label="Published" value={story.publishedKnown ? dateTime(story.publishedAt) : "UNKNOWN"} tone={story.publishedKnown ? "normal" : "warn"} />
          <TimeCell
            label="Source updated"
            value={story.sourceUpdatedAt ? dateTime(story.sourceUpdatedAt) : "UNKNOWN"}
            tone={story.sourceUpdatedAt ? "normal" : "dim"}
            sub={story.sourceUpdatedAt ? "provider-declared update / observation" : "not supplied"}
          />
          <TimeCell label="FYIP received" value={dateTime(story.receivedAt)} sub={ago(story.receivedAt)} />
          <TimeCell label="Ingested" value={dateTime(story.ingestedAt)} sub={ingestionLag ? `+${ingestionLag} store lag` : undefined} />
          <TimeCell
            label="Provider delay"
            value={sourceLag ?? (story.publishedKnown ? "n/a" : "pub unknown")}
            tone={sourceLag ? "normal" : "dim"}
            sub={story.publishedKnown ? undefined : "FYIP does not estimate a missing publication time"}
          />
        </div>

        {!story.publishedKnown && (
          <p className="border border-warn/30 bg-warn/5 px-2 py-1.5 text-3xs text-ink-dim">
            The provider did not supply a usable publication timestamp. It is displayed as unknown; received time is FYIP&apos;s observation,
            not the original publication time.
          </p>
        )}

        <div>
          <div className="mb-1 font-mono text-3xs uppercase tracking-widest text-ink-faint">Source Summary</div>
          {story.summary ? (
            <p className="whitespace-pre-line text-xs leading-relaxed text-ink-dim">{story.summary}</p>
          ) : (
            <p className="text-xs text-ink-faint">No summary was supplied by the provider. FYIP does not invent one.</p>
          )}
        </div>

        <div className="border border-line bg-panel-2">
          <div className="flex items-center gap-2 border-b border-line px-2 py-1">
            <span className="font-mono text-3xs uppercase tracking-widest text-violet">Optional AI Analysis</span>
            <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint">not a fact source</span>
          </div>
          <div className="p-2">
            {ai?.enabled ? (
              <>
                <button
                  onClick={runSummary}
                  disabled={aiBusy || !story.summary || (story.summary?.length ?? 0) < 40}
                  className="border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-violet hover:text-violet disabled:cursor-not-allowed disabled:opacity-40"
                  title={
                    !story.summary || (story.summary?.length ?? 0) < 40
                      ? "No source summary text is available; FYIP will not ask a model to invent one."
                      : `Summarize using ${ai.model}`
                  }
                >
                  {aiBusy ? "Generating" : "Summarize source"}
                </button>
                {aiBusy && <Loading label="Model reading source text" />}
                {aiError && <p className="mt-1.5 text-3xs text-down">{aiError}</p>}
                {aiResult?.summary && (
                  <div className="mt-2 border border-violet/30 bg-violet/5 p-2">
                    <p className="text-xs leading-relaxed text-ink-dim">{aiResult.summary}</p>
                    <p className="mt-1 font-mono text-3xs uppercase tracking-wider text-violet">
                      {aiResult.model} / {dateTime(aiResult.generatedAt)}
                    </p>
                    <p className="mt-1 text-3xs text-ink-faint">{aiResult.notice}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-3xs leading-relaxed text-ink-faint">{ai?.reason ?? "AI summarization is not configured."}</p>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Potential Market Channels</span>
            <span className="font-mono text-3xs uppercase tracking-wider text-warn">interpretation</span>
          </div>
          {story.impacts.length === 0 ? (
            <p className="text-3xs text-ink-faint">No rule-based transmission channel matched the source text.</p>
          ) : (
            <ul className="space-y-1">
              {story.impacts.map((impact) => (
                <li key={impact.symbol} className="border border-line bg-panel-2 p-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-2xs font-semibold text-ink">{impact.symbol}</span>
                    <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">{impact.assetClass}</span>
                    <DirectionBadge value={impact.direction} />
                    <span className="ml-auto font-mono text-3xs text-ink-faint">rule confidence {Math.round(impact.confidence * 100)}%</span>
                  </div>
                  <p className="mt-0.5 text-3xs leading-relaxed text-ink-dim">{impact.mechanism}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-3xs leading-relaxed text-ink-faint">
            These are rule-based transmission channels, not forecasts, recommendations or trading signals. Prices may move differently or not at all.
          </p>
        </div>

        <div>
          <div className="mb-1 font-mono text-3xs uppercase tracking-widest text-ink-faint">Sources ({story.sourceCount})</div>
          <ul className="space-y-1">
            {story.sources.map((source) => (
              <li key={`${source.providerKey}-${source.url ?? source.publishedAt ?? source.receivedAt}`} className="flex items-start gap-1.5 border border-line bg-panel-2 px-2 py-1">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-info" aria-hidden />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs text-ink-dim">{source.sourceName}</span>
                    {source.official && <span className="font-mono text-3xs text-up">OFFICIAL</span>}
                  </div>
                  <div className="font-mono text-3xs text-ink-faint">
                    {source.publishedAt ? dateTime(source.publishedAt) : "publication unknown"} / received {dateTime(source.receivedAt)}
                  </div>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="font-mono text-3xs text-info hover:text-amber">
                      {domain(source.url)}
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {related.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-3xs uppercase tracking-widest text-ink-faint">Related Cluster</div>
            <ul className="space-y-1">
              {related.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => onSelect(item.id)}
                    className="w-full border border-line bg-panel-2 px-2 py-1 text-left hover:border-amber/50"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-3xs uppercase tracking-wider text-info">{item.sourceName}</span>
                      <span className="ml-auto font-mono text-3xs text-ink-faint">{dateTime(item.publishedAt ?? item.receivedAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-ink-dim">{item.title}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-line pt-2">
          <div className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Attribution</div>
          <p className="mt-0.5 text-3xs leading-relaxed text-ink-dim">{story.attribution}</p>
          <p className="mt-1 text-3xs leading-relaxed text-ink-faint">{story.license}</p>
          {providerHealth && (
            <p className="mt-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
              feed status: {providerHealth.status} / poll every {providerHealth.intervalSeconds}s
              {providerHealth.lastError ? ` / last error: ${providerHealth.lastError}` : ""}
            </p>
          )}
          <p className="mt-1 text-3xs leading-relaxed text-ink-faint">
            Verification labels describe source type and independent provider count in this module. They are not legal confirmation.
          </p>
        </div>
      </div>
    </div>
  );
}

function TimeCell({
  label,
  value,
  sub,
  tone = "normal",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "normal" | "warn" | "dim";
}) {
  return (
    <div className="bg-panel px-2 py-1.5">
      <div className="font-mono text-3xs uppercase tracking-widest text-ink-faint">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-2xs tabular",
          tone === "warn" ? "text-warn" : tone === "dim" ? "text-ink-faint" : "text-ink",
        )}
      >
        {value}
      </div>
      {sub && <div className="font-mono text-3xs text-ink-faint">{sub}</div>}
    </div>
  );
}
