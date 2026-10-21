"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMarketStream } from "@/lib/client/hooks";
import { useTerminal } from "@/components/terminal/context";
import { cn, fmt, fmtCompact } from "@/lib/utils";
import { EmptyState, Loading } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DepthLadderDTO } from "@/lib/client/types";

const LEVEL_OPTIONS = [10, 20, 30, 50, 100];
const IMBALANCE_OPTIONS = [200, 300, 400, 500];
const MIN_SIZE_OPTIONS = [0, 10, 25, 50, 100];
const DENSITIES = {
  compact: { label: "XS", text: "text-3xs", pad: "py-[1px]" },
  normal: { label: "S", text: "text-2xs", pad: "py-[2px]" },
  large: { label: "M", text: "text-xs", pad: "py-[3px]" },
} as const;
type Density = keyof typeof DENSITIES;

interface DepthRow {
  key: string;
  price: number;
  bidVolume: number | null;
  askVolume: number | null;
  cumulative: number;
  bidImbalance: boolean;
  askImbalance: boolean;
}

interface LadderView {
  rows: DepthRow[];
  bidTotal: number;
  askTotal: number;
  midPrice: number | null;
  spread: number | null;
  crossed: boolean;
  tickSize: number;
}

function buttonClass(active: boolean): string {
  return cn(
    "border px-1.5 py-[3px] font-mono text-3xs uppercase tracking-wider",
    active ? "border-amber/50 bg-amber/10 text-amber" : "border-line text-ink-dim hover:border-line-2 hover:text-ink",
  );
}

function priceDigits(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString();
  if (text.includes("e-")) return Math.min(8, Number(text.split("e-")[1]));
  return Math.min(8, text.split(".")[1]?.length ?? 2);
}

function inferTickSize(ladder: DepthLadderDTO): number {
  const prices = [...ladder.bids, ...ladder.asks].map((level) => level.price).sort((a, b) => a - b);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < prices.length; i += 1) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 1e-9 && diff < min) min = diff;
  }
  return Number.isFinite(min) ? min : 0.25;
}

function ladderRows(
  ladder: DepthLadderDTO,
  levels: number,
  imbalanceRatio: number,
  minImbalanceSize: number,
): LadderView {
  const bids = ladder.bids.slice(0, levels);
  const asks = ladder.asks.slice(0, levels);
  const tickSize = inferTickSize(ladder);

  const bidTicks = new Map<number, number>();
  const askTicks = new Map<number, number>();
  for (const level of bids) bidTicks.set(Math.round(level.price / tickSize), level.volume);
  for (const level of asks) askTicks.set(Math.round(level.price / tickSize), level.volume);

  const byPrice = new Map<number, { bid: number | null; ask: number | null }>();
  for (const level of [...asks].sort((a, b) => b.price - a.price)) {
    byPrice.set(level.price, { bid: null, ask: level.volume });
  }
  for (const level of [...bids].sort((a, b) => a.price - b.price)) {
    const cell = byPrice.get(level.price);
    byPrice.set(level.price, { ask: cell?.ask ?? null, bid: level.volume });
  }

  const allPrices = [...byPrice.keys()].sort((a, b) => b - a);
  let cumulative = 0;
  const rows: DepthRow[] = allPrices.map((price) => {
    const cell = byPrice.get(price)!;
    const tick = Math.round(price / tickSize);
    const bid = bidTicks.get(tick) ?? 0;
    const ask = askTicks.get(tick) ?? 0;
    const askAhead = askTicks.get(tick + 1) ?? 0;
    const bidBehind = bidTicks.get(tick - 1) ?? 0;
    cumulative += (cell.bid ?? 0) + (cell.ask ?? 0);
    return {
      key: price.toString(),
      price,
      bidVolume: cell.bid,
      askVolume: cell.ask,
      cumulative,
      bidImbalance: bid > 0 && askAhead > 0 && bid >= imbalanceRatio * askAhead && bid >= minImbalanceSize,
      askImbalance: ask > 0 && bidBehind > 0 && ask >= imbalanceRatio * bidBehind && ask >= minImbalanceSize,
    };
  });

  const bidTotal = bids.reduce((sum, level) => sum + level.volume, 0);
  const askTotal = asks.reduce((sum, level) => sum + level.volume, 0);
  const bestBid = bids.length > 0 ? Math.max(...bids.map((level) => level.price)) : null;
  const bestAsk = asks.length > 0 ? Math.min(...asks.map((level) => level.price)) : null;
  const midPrice = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const crossed = spread !== null && spread <= 0;

  return { rows, bidTotal, askTotal, midPrice, spread, crossed, tickSize };
}

export default function DomIndex() {
  const { linkedSymbol, setLinkedSymbol } = useTerminal();
  const [symbol, setSymbol] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const [levels, setLevels] = useState(10);
  const [imbalanceRatio, setImbalanceRatio] = useState(300);
  const [minImbalanceSize, setMinImbalanceSize] = useState(0);
  const [density, setDensity] = useState<Density>("normal");
  const [showCumulative, setShowCumulative] = useState(true);
  const [autoCenter, setAutoCenter] = useState(true);
  const [flash, setFlash] = useState(true);

  const resolved = symbol ?? linkedSymbol;
  const stream = useMarketStream([resolved], ["depth"]);
  const ladder = stream.depth[resolved] ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { rows, bidTotal, askTotal, midPrice, spread, crossed, tickSize } = useMemo(
    () =>
      ladder
        ? ladderRows(ladder, levels, imbalanceRatio / 100, minImbalanceSize)
        : { rows: [], bidTotal: 0, askTotal: 0, midPrice: null, spread: null, crossed: false, tickSize: 0.25 },
    [ladder, levels, imbalanceRatio, minImbalanceSize],
  );

  const digits = priceDigits(tickSize);
  const feedBidLevels = ladder?.bids.length ?? 0;
  const feedAskLevels = ladder?.asks.length ?? 0;
  const feedTruncated = ladder !== null && (levels > feedBidLevels || levels > feedAskLevels);
  const maxVolume = Math.max(1, ...rows.map((row) => Math.max(row.bidVolume ?? 0, row.askVolume ?? 0)));
  const imbalanceCount = rows.filter((row) => row.bidImbalance || row.askImbalance).length;
  const delta = bidTotal - askTotal;
  const bidShare = bidTotal + askTotal > 0 ? (bidTotal / (bidTotal + askTotal)) * 100 : null;

  const midRowKey = useMemo(() => {
    if (midPrice === null || rows.length === 0) return null;
    let closest = rows[0];
    for (const row of rows) {
      if (Math.abs(row.price - midPrice) < Math.abs(closest.price - midPrice)) closest = row;
    }
    return closest.key;
  }, [rows, midPrice]);

  useEffect(() => {
    if (!autoCenter) return;
    const container = scrollRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>('[data-mid="true"]');
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const boxRect = container.getBoundingClientRect();
    container.scrollTop += rowRect.top - boxRect.top - container.clientHeight / 2 + rowRect.height / 2;
  }, [autoCenter, ladder, levels, density, rows.length]);

  function commit() {
    const next = input.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    setLinkedSymbol(next);
    setInput("");
  }

  const tone = DENSITIES[density];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            placeholder="Contract symbol (e.g. ESZ6) — Enter to load"
            className="w-80 border border-line-2 bg-base px-2 py-1 font-mono text-xs text-ink outline-none focus:border-amber"
          />
          <button onClick={commit} className={buttonClass(false)}>
            load
          </button>
          <span className="font-mono text-2xs uppercase tracking-wider text-amber">{resolved}</span>
          {ladder && <StatusBadge status={ladder.status ?? ladder.dataStatus} />}
          {stream.error && <span className="font-mono text-3xs text-down">{stream.error}</span>}
          <div className="ml-auto flex items-center gap-3 font-mono text-3xs uppercase tracking-wider text-ink-faint">
            {ladder && (
              <span className="max-w-52 truncate" title={new Date(ladder.eventTimestamp).toLocaleString("en-US", { hour12: false })}>
                upd {new Date(ladder.eventTimestamp).toLocaleTimeString("en-US", { hour12: false })}
              </span>
            )}
            <span className={stream.connected ? "text-up" : "text-down"}>
              {stream.connected ? "● depth stream" : "○ stream off"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5">
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Levels</span>
            {LEVEL_OPTIONS.map((value) => (
              <button key={value} onClick={() => setLevels(value)} className={buttonClass(levels === value)}>
                {value}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Imbalance</span>
            {IMBALANCE_OPTIONS.map((value) => (
              <button key={value} onClick={() => setImbalanceRatio(value)} className={buttonClass(imbalanceRatio === value)}>
                {value}%
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Min</span>
            <select
              value={minImbalanceSize}
              onChange={(event) => setMinImbalanceSize(Number(event.target.value))}
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
            <span className="mr-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Font</span>
            {(Object.keys(DENSITIES) as Density[]).map((key) => (
              <button key={key} onClick={() => setDensity(key)} className={buttonClass(density === key)}>
                {DENSITIES[key].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 font-mono text-3xs text-ink-dim">
              <input type="checkbox" checked={showCumulative} onChange={(event) => setShowCumulative(event.target.checked)} /> cum
            </label>
            <label className="flex items-center gap-1 font-mono text-3xs text-ink-dim">
              <input type="checkbox" checked={autoCenter} onChange={(event) => setAutoCenter(event.target.checked)} /> auto-center
            </label>
            <label className="flex items-center gap-1 font-mono text-3xs text-ink-dim">
              <input type="checkbox" checked={flash} onChange={(event) => setFlash(event.target.checked)} /> flash
            </label>
          </div>
          <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-faint">
            gold = diagonal imbalance · {imbalanceCount} levels
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel-2 px-3 py-1.5">
          <div className="flex items-baseline gap-3">
            <h2 className="font-mono text-2xs uppercase tracking-widest text-ink-dim">Depth of Market</h2>
            <span className="font-mono text-2xs text-amber">{resolved}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 font-mono text-2xs">
            {crossed && (
              <span
                className="border border-warn/40 bg-warn/10 px-1.5 py-[1px] font-mono text-3xs uppercase tracking-wider text-warn"
                title="Best bid is at or above best ask. The ladder is displayed exactly as received; the source feed is crossed or stale."
              >
                crossed book
              </span>
            )}
            {midPrice !== null && <span className="text-ink-dim">mid {fmt(midPrice, digits)}</span>}
            {spread !== null && <span className={crossed ? "text-warn" : "text-ink-dim"}>spread {fmt(spread, digits)}</span>}
            <span className="text-up">bid Σ {fmtCompact(bidTotal)}</span>
            <span className="text-down">ask Σ {fmtCompact(askTotal)}</span>
            <span className={delta >= 0 ? "text-up" : "text-down"}>
              Δ {delta >= 0 ? "+" : ""}
              {fmtCompact(delta)}
            </span>
            {bidShare !== null && <span className="text-ink-faint">book {bidShare.toFixed(0)}% bid</span>}
            <span
              className={feedTruncated ? "text-warn" : "text-ink-faint"}
              title="Levels actually published by the bridge feed for this symbol, before the Levels selector trims the view. The NinjaTrader Add-On forwards every level the data provider supplies, up to 100 per side."
            >
              feed {feedBidLevels}b/{feedAskLevels}a{feedTruncated ? " (feed limit)" : ""}
            </span>
            <span className="text-ink-faint">max {fmtCompact(maxVolume)}</span>
          </div>
        </div>

        {ladder === null && !stream.connected && <Loading label="Connecting to depth stream" />}
        {ladder === null && stream.connected && (
          <EmptyState
            title="No depth data yet"
            hint="Nobody is publishing a ladder for this symbol. Connect the NinjaTrader Add-On with Depth enabled (depth: true), or run the reference bridge (--depth)."
          />
        )}
        {ladder && rows.length === 0 && (
          <EmptyState title="Empty ladder" hint="Order book has no resting levels right now." />
        )}

        {ladder && rows.length > 0 && (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <table className={cn("w-full border-collapse text-right font-mono", tone.text)}>
              <thead className="sticky top-0 z-10 bg-panel-2 text-3xs uppercase tracking-wider text-ink-faint">
                <tr className="border-b border-line">
                  {showCumulative && <th className="px-3 py-1 text-left">Cum</th>}
                  <th className="px-3 py-1">Bid size</th>
                  <th className="px-3 py-1">Price</th>
                  <th className="px-3 py-1">Ask size</th>
                  {showCumulative && <th className="px-3 py-1 text-left">Cum</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isMid = row.key === midRowKey;
                  const bidPct = (row.bidVolume ?? 0) / maxVolume;
                  const askPct = (row.askVolume ?? 0) / maxVolume;
                  return (
                    <tr
                      key={row.key}
                      data-mid={isMid ? "true" : undefined}
                      className={cn("border-b border-line/40", isMid && "bg-amber/10")}
                    >
                      {showCumulative && (
                        <td className="px-3 py-[1px] text-center text-ink-faint">{fmt(row.cumulative, 0)}</td>
                      )}
                      <td
                        className={cn(
                          "relative py-[1px] pr-6",
                          row.bidImbalance && "bg-amber/15 shadow-[inset_0_0_0_1px_rgba(224,166,60,0.55)]",
                        )}
                        title={row.bidImbalance ? "Bid size dominates the ask one tick above" : undefined}
                      >
                        {row.bidVolume !== null && (
                          <span className="absolute right-0 top-0 h-full bg-up/15" style={{ width: `${bidPct * 50}%` }} />
                        )}
                        <span
                          key={`bid-${row.bidVolume}`}
                          className={cn("relative block text-up", flash && "animate-flash")}
                        >
                          {row.bidVolume !== null ? fmt(row.bidVolume, 0) : ""}
                        </span>
                      </td>
                      <td className={cn("border-x border-line px-3 py-[1px]", isMid ? "font-bold text-amber" : "text-ink")}>
                        {fmt(row.price, digits)}
                      </td>
                      <td
                        className={cn(
                          "relative py-[1px] pl-6",
                          row.askImbalance && "bg-amber/15 shadow-[inset_0_0_0_1px_rgba(224,166,60,0.55)]",
                        )}
                        title={row.askImbalance ? "Ask size dominates the bid one tick below" : undefined}
                      >
                        {row.askVolume !== null && (
                          <span className="absolute left-0 top-0 h-full bg-down/15" style={{ width: `${askPct * 50}%` }} />
                        )}
                        <span
                          key={`ask-${row.askVolume}`}
                          className={cn("relative block text-down", flash && "animate-flash")}
                        >
                          {row.askVolume !== null ? fmt(row.askVolume, 0) : ""}
                        </span>
                      </td>
                      {showCumulative && (
                        <td className="px-3 py-[1px] text-center text-ink-faint">{fmt(row.cumulative, 0)}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cn("shrink-0 font-mono text-3xs uppercase tracking-wider text-ink-faint", tone.text)}>
        Depth ladder is read-only. Size bars are scaled to the largest visible level. Imbalance compares a level with the
        opposite side one tick away; gold highlights meet the selected ratio and minimum size. A crossed book is shown as
        received, never silently repaired; the heatmap omits crossed snapshots. The Levels selector only trims the view:
        the ladder shows exactly what the bridge publishes (up to 100 levels per side with the current NinjaTrader Add-On),
        and the NinjaTrader data provider may supply fewer levels than that.
      </div>
    </div>
  );
}
