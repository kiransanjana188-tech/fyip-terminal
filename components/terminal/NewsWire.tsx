"use client";

import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/client/hooks";
import type { NewsItemDTO } from "@/lib/client/types";
import { FixtureBadge } from "@/components/ui/StatusBadge";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { cn, dateTime } from "@/lib/utils";

const PRIORITY_CLASS: Record<NewsItemDTO["priority"], string> = {
  breaking: "bg-down/20 text-down border-down/50",
  high: "bg-amber/20 text-amber border-amber/50",
  scheduled: "bg-info/15 text-info border-info/40",
  market: "bg-up/15 text-up border-up/40",
  research: "bg-violet/15 text-violet border-violet/40",
  general: "bg-panel-3 text-ink-dim border-line-2",
};

const PRIORITY_LABEL: Record<NewsItemDTO["priority"], string> = {
  breaking: "BREAKING",
  high: "HIGH",
  scheduled: "SCHED",
  market: "MARKET",
  research: "RESEARCH",
  general: "GENERAL",
};

const CATEGORIES = [
  "", "central-bank", "inflation", "employment", "economic-growth", "pmi", "treasury",
  "fiscal", "earnings", "m&a", "technology", "semiconductors", "financials", "energy",
  "geopolitics", "trade", "sanctions", "regulatory", "filings", "commodities", "fx", "digital-assets",
];

export function NewsWire({ compact = false }: { compact?: boolean }) {
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");

  const { data, error, loading, reload } = useApi<{ items: NewsItemDTO[]; hasRealContent: boolean; counts: Record<string, number> }>(
    "/news",
    { params: { priority, category, q: query, limit: compact ? 12 : 150 }, pollMs: compact ? 30000 : 15000 },
  );

  const items = data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col border border-line bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2 px-2.5 py-1.5">
        <h2 className="font-mono text-2xs uppercase tracking-widest text-ink-dim">News Wire</h2>
        {!compact && (
          <>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber"
            >
              <option value="">All priorities</option>
              {Object.keys(PRIORITY_LABEL).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p as NewsItemDTO["priority"]]}</option>)}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c || "All categories"}</option>)}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headlines…"
              className="w-44 border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber"
            />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-3xs text-ink-faint">{items.length} stories</span>
          <button onClick={reload} className="font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-amber">refresh</button>
        </div>
      </header>

      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading label="Loading wire" />}

      {data && !data.hasRealContent && (
        <div className="border border-line bg-panel-2 p-2.5">
          <div className="font-mono text-3xs uppercase tracking-widest text-amber">FYIP Wire</div>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">
            No FYIP-collected headlines are loaded in this compact view. Open FYP NEWS for the official
            FinancialJuice headlines embed or the independent FYIP news engine with source health.
          </p>
          <Link
            href="/terminal/news"
            className="mt-1.5 inline-block border border-line-2 bg-panel px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
          >
            Open FYP NEWS →
          </Link>
        </div>
      )}

      {data && items.length === 0 && data.hasRealContent && (
        <EmptyState title="No stories match" hint="Adjust the filters." />
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {items.map((n) => (
          <li key={n.id} className="border-b border-line/60 px-2.5 py-1.5 hover:bg-panel-2">
            <div className="flex items-start gap-2">
              <span className={cn("mt-[1px] shrink-0 rounded-sm border px-1.5 py-[1px] font-mono text-3xs tracking-wider", PRIORITY_CLASS[n.priority])}>
                {PRIORITY_LABEL[n.priority]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs text-ink">{n.headline}</span>
                  {n.is_fixture === 1 && <FixtureBadge />}
                </div>
                {!compact && n.summary && <p className="mt-0.5 text-3xs text-ink-faint">{n.summary}</p>}
                <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-3xs text-ink-faint">
                  <span className="uppercase tracking-wider text-ink-dim">{n.source_key}</span>
                  <span>{dateTime(n.published_at)}</span>
                  <span title="rule that assigned the priority">rule: {n.priority_rule}</span>
                  {n.categories.map((c) => <span key={c} className="rounded-sm bg-panel-3 px-1">{c}</span>)}
                  {n.instruments.map((s) => <span key={s} className="rounded-sm bg-panel-3 px-1 text-amber">{s}</span>)}
                  {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="text-info hover:text-amber">source ↗</a>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}