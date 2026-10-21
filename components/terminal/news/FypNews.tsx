"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/client/api";
import type {
  NewsAiStatusDTO,
  NewsCollectSummaryDTO,
  NewsCountsDTO,
  NewsHealthDTO,
  NewsIngestRunDTO,
  NewsSourceFacetDTO,
  NewsSourceHealthDTO,
  NewsStoriesDTO,
  NewsStoryDTO,
} from "@/lib/client/types";
import { useNow } from "@/lib/client/hooks";
import { useTerminal, can } from "@/components/terminal/context";
import { Loading, EmptyState, ErrorState } from "@/components/ui/States";
import { cn, ago, dateTime, shortTime } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  REGION_LABEL,
  REGION_ORDER,
} from "@/lib/news/taxonomy";
import { mergeNewsStories } from "@/lib/news/stream-state";
import { NewsDetail } from "./NewsDetail";
import { NewsAdmin } from "./NewsAdmin";
import { Badge, PriorityBadge, SourceStatusDot, VerificationBadge } from "./NewsBadges";

interface Filters {
  q: string;
  category: string;
  region: string;
  provider: string;
  sort: "newest" | "published" | "priority" | "relevance";
  breakingOnly: boolean;
  savedOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  q: "",
  category: "",
  region: "",
  provider: "",
  sort: "newest",
  breakingOnly: false,
  savedOnly: false,
};

const EMPTY_COUNTS: NewsCountsDTO = { total: 0, last24h: 0, breaking: 0, saved: 0 };

function hhmmss(iso: string | null): string {
  if (!iso) return "--:--:--";
  return shortTime(iso);
}

function delayLabel(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const seconds = Math.max(0, Math.round((b - a) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function sortStories(stories: NewsStoryDTO[], sort: Filters["sort"]): NewsStoryDTO[] {
  const copy = stories.slice();
  if (sort === "priority") return copy.sort((a, b) => b.urgency - a.urgency || (a.receivedAt < b.receivedAt ? 1 : -1));
  if (sort === "relevance") return copy.sort((a, b) => b.relevance - a.relevance || (a.receivedAt < b.receivedAt ? 1 : -1));
  if (sort === "published") {
    return copy.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return a.receivedAt < b.receivedAt ? 1 : -1;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return a.publishedAt < b.publishedAt ? 1 : -1;
    });
  }
  return copy.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : b.urgency - a.urgency));
}

export function FypNews() {
  const { user } = useTerminal();
  const isAdmin = can(user, "admin.providers");
  const canSave = can(user, "news.save");
  useNow(30_000);

  const [stories, setStories] = useState<NewsStoryDTO[]>([]);
  const [counts, setCounts] = useState<NewsCountsDTO>(EMPTY_COUNTS);
  const [facets, setFacets] = useState<NewsSourceFacetDTO[]>([]);
  const [healthSources, setHealthSources] = useState<NewsSourceHealthDTO[]>([]);
  const [ai, setAi] = useState<NewsAiStatusDTO | null>(null);
  const [methodology, setMethodology] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [lastCollectionAt, setLastCollectionAt] = useState<string | null>(null);
  const [collectionNote, setCollectionNote] = useState<string | null>(null);
  const [collectionEnabled, setCollectionEnabled] = useState(true);
  const [lastRun, setLastRun] = useState<NewsIngestRunDTO | null>(null);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [related, setRelated] = useState<NewsStoryDTO[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<NewsStoryDTO[] | null>(null);
  const [pending, setPending] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [collectSummary, setCollectSummary] = useState<NewsCollectSummaryDTO | null>(null);

  const [healthOpen, setHealthOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const pausedRef = useRef(false);
  const soundRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("fyip.news.sound") === "1";
      setSoundOn(saved);
      soundRef.current = saved;
    } catch {
      /* ignore storage */
    }
  }, []);

  const reloadNews = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    try {
      const [data, health] = await Promise.all([
        apiGet<NewsStoriesDTO>("/news/stories", { limit: 300 }),
        apiGet<NewsHealthDTO>("/news/health"),
      ]);
      setStories((prev) => (initial ? data.stories : mergeNewsStories(prev, data.stories, 400)));
      for (const story of data.stories) seenRef.current.add(story.id);
      setCounts(data.counts);
      setFacets(data.sources);
      setMethodology(data.methodology);
      setDisclaimer(data.disclaimer);
      setLastCollectionAt(data.lastCollectionAt ?? health.lastRun?.finishedAt ?? null);
      setHealthSources(health.sources);
      setAi(health.ai);
      setCollectionNote(health.collection.note);
      setCollectionEnabled(health.collection.collectionEnabled);
      setLastRun(health.lastRun);
      setLoadError(null);
      setInlineError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Could not load FYP NEWS.";
      if (initial) setLoadError(message);
      else setInlineError(message);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadNews(true);
  }, [reloadNews]);

  useEffect(() => {
    const es = new EventSource("/api/v1/news/stream");

    es.addEventListener("open", () => {
      setConnected(true);
      setInlineError(null);
    });
    es.addEventListener("error", () => {
      setConnected(false);
    });
    es.addEventListener("hello", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          ai?: NewsAiStatusDTO;
          methodology?: string;
          disclaimer?: string;
          collectionEnabled?: boolean;
        };
        if (payload.ai) setAi(payload.ai);
        if (payload.methodology) setMethodology(payload.methodology);
        if (payload.disclaimer) setDisclaimer(payload.disclaimer);
        if (typeof payload.collectionEnabled === "boolean") setCollectionEnabled(payload.collectionEnabled);
      } catch {
        /* ignore malformed */
      }
    });
    es.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          stories: NewsStoryDTO[];
          counts?: NewsCountsDTO;
          sources?: NewsSourceHealthDTO[];
          generatedAt?: string;
        };
        const incoming = payload.stories ?? [];
        for (const story of incoming) seenRef.current.add(story.id);
        setStories((prev) => mergeNewsStories(prev, incoming, 400));
        if (payload.counts) setCounts(payload.counts);
        if (payload.sources) setHealthSources(payload.sources);
      } catch {
        /* ignore malformed */
      }
    });
    es.addEventListener("story", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { story: NewsStoryDTO };
        const story = payload.story;
        if (!story?.id) return;
        const isNew = !seenRef.current.has(story.id);
        seenRef.current.add(story.id);
        setStories((prev) => mergeNewsStories(prev, [story], 400));
        if (isNew) {
          if (pausedRef.current) setPending((value) => value + 1);
          if (story.isBreaking && soundRef.current) playAlert(audioRef);
        }
      } catch {
        /* ignore malformed */
      }
    });
    es.addEventListener("counts", (event) => {
      try {
        setCounts(JSON.parse((event as MessageEvent).data) as NewsCountsDTO);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("health", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          sources?: NewsSourceHealthDTO[];
          counts?: NewsCountsDTO;
          lastCollectionAt?: string;
        };
        if (payload.sources) setHealthSources(payload.sources);
        if (payload.counts) setCounts(payload.counts);
        if (payload.lastCollectionAt) setLastCollectionAt(payload.lastCollectionAt);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("collect", (event) => {
      try {
        const summary = JSON.parse((event as MessageEvent).data) as NewsCollectSummaryDTO;
        setCollectSummary(summary);
        setLastCollectionAt(summary.finishedAt);
      } catch {
        /* ignore */
      }
    });

    return () => es.close();
  }, []);

  const selectedStory = useMemo(
    () => stories.find((story) => story.id === selectedId) ?? null,
    [stories, selectedId],
  );
  const selectedUpdatedAt = selectedStory?.updatedAt ?? null;

  useEffect(() => {
    if (!selectedId) {
      setRelated([]);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    apiGet<{ related: NewsStoryDTO[]; story: NewsStoryDTO }>(`/news/stories/${encodeURIComponent(selectedId)}`)
      .then((payload) => {
        if (cancelled) return;
        setRelated(payload.related);
        setDetailError(null);
      })
      .catch((err) => {
        if (!cancelled) setDetailError(err instanceof ApiError ? err.message : "Could not load story.");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedUpdatedAt]);

  const filtered = useMemo(() => {
    const base = frozen ?? stories;
    const query = filters.q.trim().toLowerCase();
    const result = base.filter((story) => {
      if (filters.category && story.category !== filters.category) return false;
      if (filters.region && story.region !== filters.region) return false;
      if (filters.provider && story.providerKey !== filters.provider) return false;
      if (filters.breakingOnly && !story.isBreaking) return false;
      if (filters.savedOnly && !story.saved) return false;
      if (query) {
        const haystack = `${story.title} ${story.summary ?? ""} ${story.entities.join(" ")} ${story.symbols.join(" ")} ${story.sourceName}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    return sortStories(result, filters.sort);
  }, [frozen, stories, filters]);

  const firstVisibleId = filtered[0]?.id ?? null;
  useEffect(() => {
    if (selectedId || !firstVisibleId) return;
    const preferred = filtered.find((story) => story.isBreaking)?.id ?? firstVisibleId;
    setSelectedId(preferred);
  }, [selectedId, firstVisibleId, filtered]);

  const breaking = useMemo(
    () => stories.filter((story) => story.isBreaking).slice(0, 10),
    [stories],
  );

  const healthByKey = useMemo(() => new Map(healthSources.map((source) => [source.key, source])), [healthSources]);
  const healthySources = healthSources.filter((source) => source.status === "ok").length;
  const enabledSources = healthSources.filter((source) => source.enabled).length;
  const unreadWhilePaused = paused ? pending : 0;

  function updateFilter(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function togglePause() {
    if (paused) {
      setPaused(false);
      pausedRef.current = false;
      setFrozen(null);
      setPending(0);
    } else {
      setFrozen(filtered);
      setPaused(true);
      pausedRef.current = true;
      setPending(0);
    }
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    soundRef.current = next;
    try {
      localStorage.setItem("fyip.news.sound", next ? "1" : "0");
    } catch {
      /* ignore storage */
    }
    if (next) {
      ensureAudio(audioRef);
      playAlert(audioRef);
    }
  }

  async function collectNow() {
    setRefreshing(true);
    setInlineError(null);
    try {
      const summary = await apiPost<NewsCollectSummaryDTO>("/news/collect");
      setCollectSummary(summary);
      setLastCollectionAt(summary.finishedAt);
      await reloadNews(false);
    } catch (err) {
      setInlineError(err instanceof ApiError ? err.message : "Manual refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleSave(story: NewsStoryDTO) {
    const next = !story.saved;
    setStories((prev) => prev.map((item) => (item.id === story.id ? { ...item, saved: next } : item)));
    setCounts((prev) => ({ ...prev, saved: Math.max(0, prev.saved + (next ? 1 : -1)) }));
    try {
      await apiPost("/news/saved", { storyId: story.id, saved: next });
    } catch (err) {
      setStories((prev) => prev.map((item) => (item.id === story.id ? { ...item, saved: !next } : item)));
      setCounts((prev) => ({ ...prev, saved: Math.max(0, prev.saved + (next ? -1 : 1)) }));
      setInlineError(err instanceof ApiError ? err.message : "Could not save headline.");
    }
  }

  function selectStory(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center border border-line bg-panel">
        <Loading label="Loading FYP NEWS" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-2">
        <ErrorState message={loadError} onRetry={() => void reloadNews(true)} />
      </div>
    );
  }

  const activeFilterCount =
    (filters.q ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.region ? 1 : 0) +
    (filters.provider ? 1 : 0) +
    (filters.breakingOnly ? 1 : 0) +
    (filters.savedOnly ? 1 : 0);

  const summaryLine = (() => {
    if (!collectSummary) return null;
    if (collectSummary.providersTried === 0) return "No source was due; interval gating or collection disabled.";
    return `Collected ${collectSummary.providersTried} source(s): ${collectSummary.itemsSeen} seen, ${collectSummary.inserted} new, ${collectSummary.merged} merged, ${collectSummary.clustered} clustered${collectSummary.errors ? `, ${collectSummary.errors} error(s)` : ""}.`;
  })();

  return (
    <div className="flex min-h-full flex-col gap-2 xl:h-full xl:min-h-0">
      <header className="border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2 px-2.5 py-1.5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-amber">FYP NEWS</h1>
              <span className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Global Financial News Engine</span>
            </div>
            <p className="mt-0.5 text-3xs text-ink-faint">
              Verified sourcing / honest timestamps / clustered developments / potential impact interpretation
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "flex items-center gap-1 border px-1.5 py-[2px] font-mono text-3xs uppercase tracking-wider",
                connected ? "border-up/40 bg-up/10 text-up" : "border-warn/40 bg-warn/10 text-warn",
              )}
              title="SSE connection to /api/v1/news/stream. Ingestion continues while the feed is paused."
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-up animate-blink" : "bg-warn")} />
              {connected ? "STREAM LIVE" : "RECONNECTING"}
            </span>
            <span className="hidden font-mono text-3xs uppercase tracking-wider text-ink-faint md:inline">
              last event {ago(lastCollectionAt)}
            </span>
            <button
              onClick={() => void collectNow()}
              disabled={refreshing}
              className="border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber disabled:opacity-50"
              title="Poll due sources now (per-source backoff still applies)"
            >
              {refreshing ? "REFRESHING" : "REFRESH"}
            </button>
            <button
              onClick={togglePause}
              className={cn(
                "border px-2 py-1 font-mono text-3xs uppercase tracking-wider",
                paused ? "border-amber/50 bg-amber/10 text-amber" : "border-line-2 bg-panel text-ink-dim hover:border-amber hover:text-amber",
              )}
              title="Freeze the visible feed. Ingestion and SSE keep running."
            >
              {paused ? `RESUME${unreadWhilePaused ? ` (${unreadWhilePaused})` : ""}` : "PAUSE"}
            </button>
            <button
              onClick={toggleSound}
              className={cn(
                "border px-2 py-1 font-mono text-3xs uppercase tracking-wider",
                soundOn ? "border-amber/50 bg-amber/10 text-amber" : "border-line-2 bg-panel text-ink-faint hover:text-ink",
              )}
              title="Breaking-news alert tone"
            >
              {soundOn ? "ALERT ON" : "ALERT OFF"}
            </button>
            <button
              onClick={() => setHealthOpen(true)}
              className="border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-info hover:text-info"
            >
              SOURCE HEALTH
            </button>
            {isAdmin && (
              <button
                onClick={() => setAdminOpen(true)}
                className="border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber"
              >
                ADMIN
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
          <span>ALL <b className="text-ink">{counts.total.toLocaleString()}</b></span>
          <span>24H <b className="text-ink">{counts.last24h}</b></span>
          <span>BREAKING <b className="text-down">{counts.breaking}</b></span>
          <span>SAVED <b className="text-amber">{counts.saved}</b></span>
          <span className="flex items-center gap-1">
            FEEDS <b className="text-ink">{healthySources}/{enabledSources}</b> healthy
          </span>
          <span>LAST COLLECT <b className="text-ink-dim">{lastCollectionAt ? ago(lastCollectionAt) : "never"}</b></span>
          {!collectionEnabled && <span className="text-warn">COLLECTION DISABLED</span>}
          {paused && <span className="text-amber">FEED PAUSED - INGESTION CONTINUES</span>}
          <span className="ml-auto normal-case tracking-normal text-ink-faint">
            {filtered.length} shown / {activeFilterCount ? `${activeFilterCount} filters` : "no filters"}
          </span>
        </div>
      </header>

      <BreakingTicker stories={breaking} onSelect={selectStory} />

      {inlineError && (
        <div className="flex items-center gap-2 border border-down/40 bg-down/5 px-2 py-1 text-xs text-down">
          {inlineError}
          <button onClick={() => setInlineError(null)} className="ml-auto font-mono text-3xs uppercase hover:text-ink">DISMISS</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border border-line bg-panel px-2 py-1.5">
        <input
          value={filters.q}
          onChange={(event) => updateFilter({ q: event.target.value })}
          placeholder="Search headline, entity, symbol..."
          className="min-w-[150px] flex-1 border border-line-2 bg-panel-2 px-2 py-1 font-mono text-2xs text-ink placeholder:text-ink-faint focus:border-amber"
          aria-label="Search news"
        />
        <select
          value={filters.category}
          onChange={(event) => updateFilter({ category: event.target.value })}
          className="border border-line-2 bg-panel-2 px-1.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim"
          aria-label="Category"
        >
          <option value="">ALL CATEGORIES</option>
          {CATEGORY_ORDER.map((key) => (
            <option key={key} value={key}>{CATEGORY_LABEL[key]}</option>
          ))}
        </select>
        <select
          value={filters.region}
          onChange={(event) => updateFilter({ region: event.target.value })}
          className="border border-line-2 bg-panel-2 px-1.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim"
          aria-label="Region"
        >
          <option value="">ALL REGIONS</option>
          {REGION_ORDER.map((key) => (
            <option key={key} value={key}>{REGION_LABEL[key]}</option>
          ))}
        </select>
        <select
          value={filters.provider}
          onChange={(event) => updateFilter({ provider: event.target.value })}
          className="max-w-[150px] border border-line-2 bg-panel-2 px-1.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim"
          aria-label="Source"
        >
          <option value="">ALL SOURCES</option>
          {facets.map((facet) => (
            <option key={facet.key} value={facet.key}>{facet.name} ({facet.count})</option>
          ))}
        </select>
        <select
          value={filters.sort}
          onChange={(event) => updateFilter({ sort: event.target.value as Filters["sort"] })}
          className="border border-line-2 bg-panel-2 px-1.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-dim"
          aria-label="Sort"
        >
          <option value="newest">NEWEST RECEIVED</option>
          <option value="published">PUBLISHED TIME</option>
          <option value="priority">URGENCY</option>
          <option value="relevance">RELEVANCE</option>
        </select>
        <button
          onClick={() => updateFilter({ breakingOnly: !filters.breakingOnly })}
          className={cn(
            "border px-2 py-1 font-mono text-3xs uppercase tracking-wider",
            filters.breakingOnly ? "border-down/50 bg-down/10 text-down" : "border-line-2 bg-panel-2 text-ink-faint hover:text-ink",
          )}
        >
          BREAKING
        </button>
        <button
          onClick={() => updateFilter({ savedOnly: !filters.savedOnly })}
          className={cn(
            "border px-2 py-1 font-mono text-3xs uppercase tracking-wider",
            filters.savedOnly ? "border-amber/50 bg-amber/10 text-amber" : "border-line-2 bg-panel-2 text-ink-faint hover:text-ink",
          )}
        >
          SAVED
        </button>
        {activeFilterCount > 0 && (
          <button onClick={resetFilters} className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-down">
            CLEAR
          </button>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section className="flex min-h-[460px] flex-col border border-line bg-panel xl:min-h-0">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-2.5 py-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-amber">The Wire</span>
            <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">
              {filtered.length} stories / newest first by FYIP receipt
            </span>
            <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint">
              published time is provider-supplied
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <EmptyState
                title={stories.length === 0 ? "No stories collected yet" : "No stories match these filters"}
                hint={
                  stories.length === 0
                    ? "FYP NEWS collects documented public feeds while this page is open. Use REFRESH to poll due sources. If all feeds are rate-limited or unavailable, the Source Health panel shows the exact errors - nothing is fabricated."
                    : "Clear filters or search terms to return to the full wire."
                }
              />
            ) : (
              filtered.map((story) => (
                <StoryRow
                  key={story.id}
                  story={story}
                  selected={story.id === selectedId}
                  sourceStatus={healthByKey.get(story.providerKey)?.status}
                  canSave={canSave}
                  onSelect={() => selectStory(story.id)}
                  onSave={() => void toggleSave(story)}
                />
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-panel-2 px-2.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
            <span className="text-amber">FYIP NEWS</span>
            <span>{summaryLine ?? (lastRun ? `last run: ${lastRun.providersTried} sources / ${lastRun.errors} errors` : "no collection run recorded")}</span>
            {lastRun?.errors ? <span className="text-warn">check source health for upstream errors</span> : null}
            <span className="ml-auto normal-case tracking-normal text-ink-faint">{collectionNote}</span>
          </div>
        </section>

        <aside className="hidden min-h-0 flex-col overflow-hidden border border-line bg-panel xl:flex">
          <NewsDetail
            story={selectedStory}
            related={related}
            sources={healthSources}
            ai={ai}
            loading={detailLoading && !selectedStory}
            error={detailError}
            canSave={canSave}
            onSave={(story) => void toggleSave(story)}
            onSelect={(id) => setSelectedId(id)}
          />
        </aside>
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-line bg-panel-2 px-2.5 py-1 text-3xs text-ink-faint">
        <span className="font-mono uppercase tracking-wider text-amber">Method</span>
        <span className="max-w-4xl leading-relaxed">{disclaimer || "Impact notes are interpretations, not signals."}</span>
        <span className="ml-auto font-mono uppercase tracking-wider">SSE / DB-clustered / no fabricated timestamps</span>
      </footer>

      {mobileDetailOpen && selectedStory && (
        <div className="fixed inset-0 z-40 flex flex-col bg-base xl:hidden">
          <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
            <span className="font-mono text-2xs uppercase tracking-widest text-amber">Story Context</span>
            <button onClick={() => setMobileDetailOpen(false)} className="ml-auto font-mono text-3xs uppercase text-ink-faint hover:text-down">
              CLOSE
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <NewsDetail
              story={selectedStory}
              related={related}
              sources={healthSources}
              ai={ai}
              loading={detailLoading && !selectedStory}
              error={detailError}
              canSave={canSave}
              onSave={(story) => void toggleSave(story)}
              onSelect={(id) => setSelectedId(id)}
            />
          </div>
        </div>
      )}

      <NewsAdmin
        open={adminOpen}
        onClose={() => setAdminOpen(false)}
        onSaved={(sources, nextAi) => {
          setHealthSources(sources);
          setAi(nextAi);
          void reloadNews(false);
        }}
      />

      {healthOpen && (
        <SourceHealthPanel
          sources={healthSources}
          lastRun={lastRun}
          note={collectionNote}
          methodology={methodology}
          onClose={() => setHealthOpen(false)}
        />
      )}
    </div>
  );
}

function StoryRow({
  story,
  selected,
  sourceStatus,
  canSave,
  onSelect,
  onSave,
}: {
  story: NewsStoryDTO;
  selected: boolean;
  sourceStatus?: string;
  canSave: boolean;
  onSelect: () => void;
  onSave: () => void;
}) {
  const sourceDelay = story.publishedKnown ? delayLabel(story.publishedAt, story.receivedAt) : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "grid cursor-pointer grid-cols-[3.4rem_minmax(0,1fr)_auto] gap-2 border-b border-line px-2 py-1.5 outline-none transition-colors hover:bg-panel-2 focus-visible:bg-panel-2",
        selected && "border-l-2 border-l-amber bg-panel-3",
      )}
    >
      <div className="pt-0.5 text-right">
        <div className={cn("font-mono text-2xs tabular", story.publishedKnown ? "text-ink-dim" : "text-warn")}>
          {hhmmss(story.publishedAt)}
        </div>
        <div className="font-mono text-3xs uppercase tracking-wider text-ink-faint">
          {story.publishedKnown ? "PUB" : "PUB?"}
        </div>
        <div className="mt-0.5 font-mono text-3xs text-ink-faint">{ago(story.receivedAt)}</div>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1">
          <VerificationBadge value={story.verification} />
          <PriorityBadge value={story.priority} />
          {story.status !== "new" && (
            <Badge className="border-amber/30 bg-amber/5 text-amber">{story.status}</Badge>
          )}
          {story.clusterSize > 1 && (
            <Badge className="border-info/30 bg-info/5 text-info">{story.clusterSize} reports</Badge>
          )}
          {story.isFixture && <Badge className="border-violet/40 bg-violet/10 text-violet">FIXTURE</Badge>}
          {story.symbols.slice(0, 4).map((symbol) => (
            <span key={symbol} className="font-mono text-3xs text-info">{symbol}</span>
          ))}
        </div>
        <p className={cn("mt-0.5 line-clamp-2 text-xs leading-snug", story.isBreaking ? "font-semibold text-ink" : "text-ink-dim")}>
          {story.title}
        </p>
        {story.summary && <p className="mt-0.5 line-clamp-1 text-3xs text-ink-faint">{story.summary}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-3xs uppercase tracking-wider text-ink-faint">
          <span className="flex items-center gap-1">
            <SourceStatusDot status={sourceStatus ?? "pending"} />
            {story.sourceName}
          </span>
          <span>{CATEGORY_LABEL[story.category as keyof typeof CATEGORY_LABEL] ?? story.category}</span>
          <span>{REGION_LABEL[story.region as keyof typeof REGION_LABEL] ?? story.region}</span>
          <span>U{story.urgency} / R{story.relevance}</span>
          {sourceDelay && <span>provider delay {sourceDelay}</span>}
          {!story.publishedKnown && <span className="text-warn">publication time unknown</span>}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        {canSave && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onSave();
            }}
            className={cn(
              "border px-1 py-[1px] font-mono text-3xs uppercase tracking-wider",
              story.saved
                ? "border-amber/50 bg-amber/10 text-amber"
                : "border-line-2 bg-panel text-ink-faint hover:border-amber hover:text-amber",
            )}
            title={story.saved ? "Remove from saved" : "Save headline"}
          >
            {story.saved ? "SAVED" : "SAVE"}
          </button>
        )}
        {story.url && (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-info"
            title="Open original source"
          >
            SRC
          </a>
        )}
      </div>
    </div>
  );
}

function BreakingTicker({ stories, onSelect }: { stories: NewsStoryDTO[]; onSelect: (id: string) => void }) {
  if (stories.length === 0) {
    return (
      <div className="flex items-center gap-2 border border-line bg-panel px-2.5 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
        <span className="border border-line-2 px-1.5 py-[1px] text-ink-faint">ALERTS</span>
        <span>No active breaking flags. Verification labels are not confirmation.</span>
      </div>
    );
  }
  const track = (
    <div className="flex shrink-0 items-center">
      {stories.map((story) => (
        <button
          key={story.id}
          onClick={() => onSelect(story.id)}
          className="mx-4 flex shrink-0 items-center gap-2 text-left hover:text-amber"
        >
          <span className="font-mono text-3xs tabular text-ink-faint">{hhmmss(story.publishedAt)}</span>
          <span className="font-mono text-3xs uppercase tracking-wider text-down">BREAKING</span>
          <span className="text-2xs text-ink">{story.title}</span>
          <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">{story.sourceName}</span>
        </button>
      ))}
    </div>
  );
  return (
    <div className="flex items-center gap-2 overflow-hidden border border-down/30 bg-down/5 px-2">
      <span className="shrink-0 border border-down/50 bg-down/10 px-1.5 py-[2px] font-mono text-3xs uppercase tracking-widest text-down">
        Breaking
      </span>
      <div className="min-w-0 flex-1 overflow-hidden py-1">
        <div className="flex w-max animate-ticker items-center whitespace-nowrap hover:[animation-play-state:paused] motion-reduce:animate-none">
          {track}
          <div aria-hidden="true" className="flex shrink-0 items-center">{track}</div>
        </div>
      </div>
    </div>
  );
}

function SourceHealthPanel({
  sources,
  lastRun,
  note,
  methodology,
  onClose,
}: {
  sources: NewsSourceHealthDTO[];
  lastRun: NewsIngestRunDTO | null;
  note: string | null;
  methodology: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col border border-line-2 bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line bg-panel-2 px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-amber">Source Health</span>
          <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">
            {sources.filter((source) => source.enabled).length} enabled / {sources.filter((source) => source.status === "ok").length} healthy
          </span>
          <button onClick={onClose} className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-down">
            CLOSE
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-2 border border-warn/30 bg-warn/5 px-2 py-1.5 text-3xs leading-relaxed text-ink-dim">{note}</p>
          <div className="overflow-x-auto border border-line">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-panel-2 font-mono text-3xs uppercase tracking-widest text-ink-faint">
                <tr>
                  <th className="px-2 py-1">Feed</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Interval</th>
                  <th className="px-2 py-1">Last success</th>
                  <th className="px-2 py-1">Latency</th>
                  <th className="px-2 py-1">Items</th>
                  <th className="px-2 py-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.key} className="border-t border-line align-top">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <SourceStatusDot status={source.status} />
                        <span className="text-xs text-ink">{source.name}</span>
                        {source.official && <span className="font-mono text-3xs text-up">OFFICIAL</span>}
                      </div>
                      <div className="font-mono text-3xs text-ink-faint">{source.key}{source.regionHint ? ` / ${source.regionHint}` : ""}</div>
                    </td>
                    <td className={cn("px-2 py-1.5 font-mono text-3xs uppercase", source.status === "error" ? "text-down" : source.status === "ok" ? "text-up" : "text-warn")}>
                      {source.status}
                      {source.consecutiveFailures > 0 ? ` x${source.consecutiveFailures}` : ""}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-3xs tabular text-ink-dim">{source.intervalSeconds}s</td>
                    <td className="px-2 py-1.5 font-mono text-3xs text-ink-dim">
                      {source.lastSuccessAt ? dateTime(source.lastSuccessAt) : "never"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-3xs tabular text-ink-dim">
                      {source.lastLatencyMs == null ? "-" : `${source.lastLatencyMs}ms`}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-3xs tabular text-ink-dim">
                      {source.itemsTotal.toLocaleString()}
                    </td>
                    <td className="max-w-[260px] px-2 py-1.5 text-3xs leading-relaxed text-ink-faint">
                      {source.lastError ? <span className="text-down">{source.lastError}</span> : source.unavailableReason ?? source.attribution}
                      <div className="mt-0.5 break-all font-mono text-[0.55rem] text-ink-faint">{source.endpoint ?? "endpoint locked / unavailable"}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {lastRun && (
            <div className="mt-2 border border-line bg-panel-2 p-2">
              <div className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Last collection run</div>
              <div className="mt-0.5 font-mono text-3xs text-ink-dim">
                {dateTime(lastRun.finishedAt)} / {lastRun.providersTried} sources / {lastRun.itemsSeen} seen / {lastRun.inserted} new / {lastRun.merged} merged / {lastRun.clustered} clustered / {lastRun.errors} errors
              </div>
            </div>
          )}
          <p className="mt-2 text-3xs leading-relaxed text-ink-faint">{methodology}</p>
        </div>
      </div>
    </div>
  );
}

function ensureAudio(ref: React.MutableRefObject<AudioContext | null>): AudioContext | null {
  if (ref.current) return ref.current;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ref.current = new Ctor();
    return ref.current;
  } catch {
    return null;
  }
}

function playAlert(ref: React.MutableRefObject<AudioContext | null>) {
  const ctx = ensureAudio(ref);
  if (!ctx) return;
  try {
    void ctx.resume();
    const start = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.05, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    gain.connect(ctx.destination);
    for (const [frequency, offset] of [[880, 0], [660, 0.19]] as const) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, start + offset);
      oscillator.connect(gain);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.17);
    }
  } catch {
    /* audio unavailable */
  }
}
