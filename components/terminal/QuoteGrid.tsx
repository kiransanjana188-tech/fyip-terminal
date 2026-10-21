"use client";

import { useMemo, useState } from "react";
import { useApi, useQuoteStream } from "@/lib/client/hooks";
import type { QuoteView } from "@/lib/client/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { useTerminal } from "./context";
import { cn, fmt, fmtCompact, fmtPct } from "@/lib/utils";

interface QuotesResponse {
  quotes: QuoteView[];
  asOf: string;
}

interface Row {
  symbol: string;
  name: string;
  assetClass: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  volume: number | null;
  priceScale: number;
  provider: string | null;
  status: QuoteView["dataStatus"];
  entitlement: string | null;
}

type SortKey = "symbol" | "last" | "changePct" | "volume";

export function QuoteGrid({
  symbols,
  assetClass,
  title,
  stream = true,
  maxRows = 400,
}: {
  symbols: string[] | null;
  assetClass?: string;
  title: string;
  stream?: boolean;
  maxRows?: number;
}) {
  const { setLinkedSymbol } = useTerminal();
  const { data, error, loading, reload } = useApi<QuotesResponse>("/quotes", {
    params: symbols ? { symbols: symbols.join(",") } : { assetClass },
  });
  const live = useQuoteStream(stream ? symbols : null);
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [asc, setAsc] = useState(true);

  const rows: Row[] = useMemo(() => {
    const base = data?.quotes ?? [];
    const merged = base.map((q) => {
      // Continuous roots (ES1!) stream updates for their front contract (ESZ6);
      // resolveContract is from the quote master, updated per event.
      const s = live.quotes[q.resolvedContract ?? ""] ?? live.quotes[q.symbol];
      const last = s?.last ?? q.last;
      const prevClose = s?.prevClose ?? q.prevClose;
      const bid = s?.bid ?? q.bid;
      const ask = s?.ask ?? q.ask;
      const volume = s?.volume ?? q.volume;
      const change = last !== null && prevClose != null ? last - prevClose : q.change;
      const changePct = change !== null && prevClose ? (change / prevClose) * 100 : q.changePct;
      return {
        symbol: q.symbol,
        name: q.displayName,
        assetClass: q.assetClass,
        last,
        change,
        changePct,
        bid,
        ask,
        spread: bid !== null && ask !== null ? ask - bid : q.spread,
        volume,
        priceScale: q.priceScale,
        provider: s?.provider ?? q.provider,
        status: s?.status ?? q.dataStatus,
        entitlement: s?.entitlement ?? q.entitlement,
      } satisfies Row;
    });
    const key = (r: Row): number | string => {
      if (sortKey === "symbol") return r.symbol;
      if (sortKey === "last") return r.last ?? -Infinity;
      if (sortKey === "volume") return r.volume ?? -Infinity;
      return r.changePct ?? -Infinity;
    };
    merged.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (typeof ka === "string" || typeof kb === "string") return String(ka).localeCompare(String(kb)) * (asc ? 1 : -1);
      return (ka - kb) * (asc ? 1 : -1);
    });
    return merged.slice(0, maxRows);
  }, [data, live.quotes, sortKey, asc, maxRows]);

  function header(k: SortKey, label: string, className: string) {
    return (
      <th
        className={cn("cursor-pointer select-none px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-amber", className)}
        onClick={() => { if (sortKey === k) setAsc((a) => !a); else { setSortKey(k); setAsc(k === "symbol"); } }}
      >
        {label}{sortKey === k ? (asc ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line bg-panel-2 px-2.5 py-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="font-mono text-2xs uppercase tracking-widest text-ink-dim">{title}</h2>
          <span className="font-mono text-3xs text-ink-faint">{rows.length} instruments</span>
        </div>
        <div className="flex items-center gap-2">
          {stream && (
            <span className={cn("font-mono text-3xs uppercase tracking-wider", live.connected ? "text-up" : "text-down")}>
              {live.connected ? "● stream" : "○ stream off"}
            </span>
          )}
          <button onClick={reload} className="font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-amber">
            refresh
          </button>
        </div>
      </header>

      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading label="Loading quotes" />}

      {data && rows.length === 0 && (
        <EmptyState title="No quotes" hint="No market-data provider is producing values for these instruments. Configure the NinjaTrader bridge or enable development fixtures." />
      )}

      {rows.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-right">
            <thead className="sticky top-0 z-10 bg-panel-2">
              <tr className="border-b border-line">
                {header("symbol", "Symbol", "text-left")}
                <th className="px-2 py-1 text-left font-mono text-3xs uppercase tracking-wider text-ink-faint">Name</th>
                {header("last", "Last", "")}
                <th className="px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Chg</th>
                {header("changePct", "Chg%", "")}
                <th className="px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Bid</th>
                <th className="px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Ask</th>
                <th className="px-2 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Sprd</th>
                {header("volume", "Vol", "")}
                <th className="px-2 py-1 text-left font-mono text-3xs uppercase tracking-wider text-ink-faint">Src</th>
                <th className="px-2 py-1 text-left font-mono text-3xs uppercase tracking-wider text-ink-faint">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dir = r.changePct === null ? "text-ink-dim" : r.changePct > 0 ? "text-up" : r.changePct < 0 ? "text-down" : "text-ink-dim";
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => setLinkedSymbol(r.symbol)}
                    title={`${r.entitlement ?? ""}`}
                    className="cursor-pointer border-b border-line/50 hover:bg-panel-2"
                  >
                    <td className="px-2 py-[3px] text-left font-mono text-2xs text-amber">{r.symbol}</td>
                    <td className="max-w-[16rem] truncate px-2 py-[3px] text-left text-2xs text-ink-dim">{r.name}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink">{fmt(r.last, r.priceScale)}</td>
                    <td className={cn("px-2 py-[3px] font-mono text-2xs tabular", dir)}>{r.change === null ? "—" : fmt(r.change, r.priceScale)}</td>
                    <td className={cn("px-2 py-[3px] font-mono text-2xs tabular", dir)}>{r.changePct === null ? "—" : fmtPct(r.changePct)}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink-dim">{fmt(r.bid, r.priceScale)}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink-dim">{fmt(r.ask, r.priceScale)}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink-faint">{fmt(r.spread, r.priceScale)}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink-dim">{fmtCompact(r.volume)}</td>
                    <td className="px-2 py-[3px] text-left font-mono text-3xs text-ink-faint">{r.provider ?? "—"}</td>
                    <td className="px-2 py-[3px] text-left"><StatusBadge status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}