"use client";

import { useMemo, useState } from "react";
import { useApi, useMarketStream } from "@/lib/client/hooks";
import { useTerminal } from "@/components/terminal/context";
import { cn, fmt, fmtCompact, fmtSigned } from "@/lib/utils";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DataStatus, TradeHistoryDTO, TradePrintDTO } from "@/lib/client/types";

const SYMBOL_SUGGESTIONS = ["ESZ6", "NQZ6", "YMZ6", "RTYZ6", "GCZ6", "CLZ6", "ZN", "ES", "NQ"];
const SIDE_OPTIONS = ["all", "buy", "sell", "cross", "unknown"] as const;
type SideFilter = (typeof SIDE_OPTIONS)[number];
const MIN_SIZE_OPTIONS = [0, 1, 5, 10, 25, 50, 100];
const LARGE_OPTIONS = [0, 10, 25, 50, 100, 500];
const DISPLAY_LIMITS = [200, 500, 1000, 2000];

function buttonClass(active: boolean): string {
  return cn(
    "border px-1.5 py-[3px] font-mono text-3xs uppercase tracking-wider",
    active ? "border-amber/50 bg-amber/10 text-amber" : "border-line text-ink-dim hover:border-line-2 hover:text-ink",
  );
}

function msTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleTimeString("en-US", { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function tradeKey(trade: TradePrintDTO): string {
  return `${trade.eventTimestamp}|${trade.price}|${trade.size}|${trade.side ?? "null"}`;
}

function sideClass(side: TradePrintDTO["side"]): string {
  if (side === "buy") return "text-up";
  if (side === "sell") return "text-down";
  if (side === "cross") return "text-violet";
  return "text-ink-faint";
}

function sourceClass(source: TradePrintDTO["sideSource"]): string {
  if (source === "provider") return "text-ink-faint";
  if (source === "inferred") return "text-warn";
  return "text-ink-faint";
}

export default function TapeIndex() {
  const { linkedSymbol, setLinkedSymbol } = useTerminal();
  const [symbol, setSymbol] = useState<string | null>(null);
  const [input, setInput] = useState(linkedSymbol);
  const resolved = symbol ?? linkedSymbol;

  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [minSize, setMinSize] = useState(0);
  const [largeThreshold, setLargeThreshold] = useState(50);
  const [displayLimit, setDisplayLimit] = useState(500);
  const [pausedUntil, setPausedUntil] = useState<string | null>(null);

  const history = useApi<TradeHistoryDTO>("/market/trades", { params: { symbol: resolved, limit: 10000 } });
  const stream = useMarketStream([resolved], ["trade"], 6000);

  const pauseCut = pausedUntil ? new Date(pausedUntil).getTime() : Number.POSITIVE_INFINITY;

  const merged = useMemo<TradePrintDTO[]>(() => {
    const seen = new Set<string>();
    const trades: TradePrintDTO[] = [];
    for (const trade of [...stream.trades, ...(history.data?.trades ?? [])]) {
      const key = tradeKey(trade);
      if (seen.has(key)) continue;
      seen.add(key);
      trades.push(trade);
    }
    trades.sort((a, b) => new Date(b.eventTimestamp).getTime() - new Date(a.eventTimestamp).getTime());
    return trades;
  }, [history.data, stream.trades]);

  const filtered = useMemo(
    () =>
      merged.filter((trade) => {
        if (new Date(trade.eventTimestamp).getTime() > pauseCut) return false;
        if (sideFilter === "unknown" && trade.side !== null) return false;
        if (sideFilter !== "all" && sideFilter !== "unknown" && trade.side !== sideFilter) return false;
        if (trade.size < minSize) return false;
        return true;
      }),
    [merged, pauseCut, sideFilter, minSize],
  );

  const stats = useMemo(() => {
    let volume = 0;
    let buy = 0;
    let sell = 0;
    let cross = 0;
    let unknown = 0;
    let large = 0;
    for (const trade of filtered) {
      volume += trade.size;
      if (trade.side === "buy") buy += trade.size;
      else if (trade.side === "sell") sell += trade.size;
      else if (trade.side === "cross") cross += trade.size;
      else unknown += trade.size;
      if (largeThreshold > 0 && trade.size >= largeThreshold) large += 1;
    }
    return {
      prints: filtered.length,
      volume,
      buy,
      sell,
      cross,
      unknown,
      delta: buy - sell,
      large,
      average: filtered.length > 0 ? volume / filtered.length : 0,
    };
  }, [filtered, largeThreshold]);

  const visible = filtered.slice(0, displayLimit);
  const contractSymbol = history.data?.contractSymbol ?? resolved;
  const priceScale = history.data?.priceScale ?? 2;
  const status: DataStatus =
    filtered[0]?.dataStatus ?? stream.trades[0]?.dataStatus ?? history.data?.dataStatus ?? "unavailable";
  const hasAny = merged.length > 0;

  function commit(): void {
    const next = input.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    setLinkedSymbol(next);
    setInput(next);
    setPausedUntil(null);
  }

  function togglePause(): void {
    setPausedUntil((current) => (current ? null : new Date().toISOString()));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <span className="font-mono text-2xs uppercase tracking-widest text-amber">TAPE</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            list="tape-symbols"
            placeholder="Contract symbol (e.g. ESZ6) — Enter to load"
            className="w-72 border border-line-2 bg-base px-2 py-1 font-mono text-xs text-ink outline-none focus:border-amber"
          />
          <datalist id="tape-symbols">
            {SYMBOL_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button onClick={commit} className={buttonClass(false)}>
            load
          </button>
          <span className="font-mono text-2xs uppercase tracking-wider text-amber">{resolved}</span>
          {contractSymbol !== resolved && (
            <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">→ {contractSymbol}</span>
          )}
          <StatusBadge status={status} />
          <span className={cn("font-mono text-3xs uppercase tracking-wider", stream.connected ? "text-up" : "text-down")}>
            {stream.connected ? "● prints" : "○ stream off"}
          </span>
          {pausedUntil && (
            <span className="border border-warn/40 bg-warn/10 px-1.5 py-[1px] font-mono text-3xs uppercase tracking-wider text-warn">
              paused {new Date(pausedUntil).toLocaleTimeString("en-US", { hour12: false })}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 font-mono text-3xs text-ink-faint">
            <span>archive {(history.data?.stats.tradeCount ?? 0).toLocaleString("en-US")}</span>
            <span>live ring {stream.trades.length.toLocaleString("en-US")}</span>
            <button onClick={history.reload} className={buttonClass(false)}>
              reload
            </button>
            <button onClick={togglePause} className={buttonClass(!!pausedUntil)}>
              {pausedUntil ? "resume" : "pause"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5">
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Side</span>
            {SIDE_OPTIONS.map((value) => (
              <button key={value} onClick={() => setSideFilter(value)} className={buttonClass(sideFilter === value)}>
                {value === "unknown" ? "unk" : value}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Min size</span>
            <select
              value={minSize}
              onChange={(event) => setMinSize(Number(event.target.value))}
              className="border border-line-2 bg-base px-1 py-[3px] font-mono text-3xs text-ink outline-none focus:border-amber"
            >
              {MIN_SIZE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? "off" : `≥ ${value}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Large</span>
            <select
              value={largeThreshold}
              onChange={(event) => setLargeThreshold(Number(event.target.value))}
              className="border border-line-2 bg-base px-1 py-[3px] font-mono text-3xs text-ink outline-none focus:border-amber"
            >
              {LARGE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? "off" : `≥ ${value}`}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Rows</span>
            <select
              value={displayLimit}
              onChange={(event) => setDisplayLimit(Number(event.target.value))}
              className="border border-line-2 bg-base px-1 py-[3px] font-mono text-3xs text-ink outline-none focus:border-amber"
            >
              {DISPLAY_LIMITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint">
            gold = large print · inferred sides are not exchange aggressor flags
          </span>
        </div>
      </div>

      {history.error && (
        <div className="shrink-0">
          <ErrorState message={history.error.message} onRetry={history.reload} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel-2 px-3 py-1.5 font-mono text-3xs uppercase tracking-wider text-ink-faint">
          <span className="text-2xs text-ink-dim">Time &amp; Sales</span>
          <span className="text-amber">{contractSymbol}</span>
          <span>{stats.prints.toLocaleString("en-US")} prints</span>
          <span>vol {fmtCompact(stats.volume)}</span>
          <span className="text-up">buy {fmtCompact(stats.buy)}</span>
          <span className="text-down">sell {fmtCompact(stats.sell)}</span>
          <span className={stats.delta >= 0 ? "text-up" : "text-down"}>Δ {fmtSigned(stats.delta, 0)}</span>
          <span>avg {fmt(stats.average, 0)}</span>
          <span>large {stats.large}</span>
          {stats.unknown > 0 && <span>unk {fmtCompact(stats.unknown)}</span>}
          <span className="ml-auto normal-case tracking-normal text-ink-faint">
            {pausedUntil ? `frozen at ${msTime(pausedUntil)}` : stream.connected ? "streaming + archive" : "archive only"}
          </span>
        </div>

        {!hasAny && history.loading && <Loading label="Loading trade history" />}
        {!hasAny && !history.loading && (
          <EmptyState
            title="No prints yet"
            hint="Trade prints stream from the bridge trade channel. Start the reference bridge with --trades or connect the NinjaTrader Add-On (trades: true). Archived prints appear here after the first ingest."
          />
        )}
        {hasAny && filtered.length === 0 && (
          <EmptyState title="No prints match the filters" hint="Relax the side/size filters, raise the display limit or resume the tape." />
        )}

        {visible.length > 0 && (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-right font-mono text-2xs">
              <thead className="sticky top-0 z-10 bg-panel-2 text-3xs uppercase tracking-wider text-ink-faint">
                <tr className="border-b border-line">
                  <th className="px-3 py-1 text-left">Time</th>
                  <th className="px-3 py-1">Price</th>
                  <th className="px-3 py-1">Size</th>
                  <th className="px-3 py-1 text-left">Side</th>
                  <th className="px-3 py-1 text-left">Side via</th>
                  <th className="px-3 py-1 text-left">Provider</th>
                  <th className="px-3 py-1 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((trade, index) => {
                  const isLarge = largeThreshold > 0 && trade.size >= largeThreshold;
                  return (
                    <tr
                      key={
                        trade.id !== undefined
                          ? `id-${trade.id}`
                          : `${trade.instrumentId}-${trade.eventTimestamp}-${trade.price}-${trade.size}-${trade.side ?? "null"}-${index}`
                      }
                      className={cn("border-b border-line/40", isLarge && "bg-amber/10")}
                    >
                      <td className="px-3 py-[2px] text-left tabular text-ink-faint">{msTime(trade.eventTimestamp)}</td>
                      <td className={cn("py-[2px] tabular", isLarge ? "font-bold text-amber" : sideClass(trade.side))}>
                        {fmt(trade.price, priceScale)}
                      </td>
                      <td className={cn("py-[2px] tabular", isLarge ? "font-bold text-ink" : "text-ink-dim")}>
                        {fmt(trade.size, 0)}
                      </td>
                      <td className={cn("px-3 py-[2px] text-left", sideClass(trade.side))}>{trade.side ?? "—"}</td>
                      <td className={cn("px-3 py-[2px] text-left", sourceClass(trade.sideSource))}>
                        {trade.sideSource ?? "—"}
                      </td>
                      <td className="max-w-32 truncate px-3 py-[2px] text-left text-ink-faint" title={trade.providerSymbol ?? undefined}>
                        {trade.provider}
                      </td>
                      <td className="px-3 py-[2px] text-left">
                        <StatusBadge status={trade.dataStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {visible.length > 0 && filtered.length > visible.length && (
          <div className="border-t border-line bg-panel-2 px-3 py-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
            showing {visible.length.toLocaleString("en-US")} of {filtered.length.toLocaleString("en-US")} filtered prints —
            session stats cover all filtered prints
          </div>
        )}
      </div>
    </div>
  );
}
