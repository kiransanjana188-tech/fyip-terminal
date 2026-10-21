"use client";

import { useMemo, useState } from "react";
import { VolumeProfileChart } from "@/components/analytics/VolumeProfileChart";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { BlockerNote, ErrorState, Loading } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useApi } from "@/lib/client/hooks";
import type { FuturesAnalyticsResponse } from "@/lib/client/futures";
import { cn, dateTime, fmt, fmtCompact, fmtPct, fmtSigned } from "@/lib/utils";

const SYMBOLS = ["ESZ6", "NQZ6", "YMZ6", "RTYZ6", "GCZ6", "CLZ6", "ZN", "ES1!", "NQ1!"];
const WINDOWS = [
  { value: 8, label: "8h" },
  { value: 24, label: "24h" },
  { value: 48, label: "48h" },
  { value: 72, label: "72h" },
];
const RANGES = [
  { value: 1, label: "±1%" },
  { value: 2, label: "±2%" },
  { value: 5, label: "±5%" },
  { value: 0, label: "All" },
];

const selectClass =
  "border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber";

export default function FuturesProfilePage() {
  const [symbol, setSymbol] = useState("ESZ6");
  const [hours, setHours] = useState(24);
  const [rangePct, setRangePct] = useState(2);

  const { data, error, loading, reload } = useApi<FuturesAnalyticsResponse>("/futures/analytics", {
    params: { symbol, hours, rowTicks: 2 },
    pollMs: 15000,
  });

  const quote = data?.quote ?? null;
  const profile = data?.profile ?? null;
  const spot = quote?.last ?? null;
  const digits = data?.priceScale ?? 2;

  const visibleBins = useMemo(() => {
    if (!profile) return [];
    if (!rangePct || !spot) return profile.bins;
    const low = spot * (1 - rangePct / 100);
    const high = spot * (1 + rangePct / 100);
    return profile.bins.filter((bin) => bin.price >= low && bin.price <= high);
  }, [profile, rangePct, spot]);

  const changeClass = (value: number | null) =>
    value === null || value === 0 ? "text-ink-dim" : value > 0 ? "text-up" : "text-down";

  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <Panel
        title="Futures profile"
        subtitle="volume at price · VWAP · session levels · futures-only"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <label className="flex items-center gap-1">
              <span className="text-3xs uppercase tracking-wider text-ink-faint">Symbol</span>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className={selectClass}>
                {SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-3xs uppercase tracking-wider text-ink-faint">Window</span>
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={selectClass}>
                {WINDOWS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-3xs uppercase tracking-wider text-ink-faint">Range</span>
              <select value={rangePct} onChange={(e) => setRangePct(Number(e.target.value))} className={selectClass}>
                {RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={reload}
              className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
            >
              Refresh
            </button>
          </div>
        }
      >
        {error && <ErrorState message={error.message} onRetry={reload} />}
        {!error && loading && !data && <Loading label="Loading futures analytics" />}
        {data && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm tracking-widest text-amber">{data.contractSymbol ?? data.symbol}</span>
                <span className="text-xs text-ink-dim">{data.displayName ?? "—"}</span>
                <StatusBadge status={data.dataStatus} />
              </div>
              {quote && (
                <>
                  <span className="font-mono text-lg tabular text-ink">{fmt(quote.last, digits)}</span>
                  <span className={cn("font-mono text-xs tabular", changeClass(quote.change))}>
                    {fmtSigned(quote.change, digits)} ({fmtPct(quote.changePct)})
                  </span>
                  <span className="font-mono text-2xs tabular text-ink-dim">
                    bid {fmt(quote.bid, digits)} · ask {fmt(quote.ask, digits)} · spread {fmt(quote.spread, digits)}
                  </span>
                </>
              )}
              <span className="ml-auto font-mono text-3xs text-ink-faint">as of {dateTime(data.asOf)}</span>
            </div>

            {!data.available && data.reason && <BlockerNote>{data.reason}</BlockerNote>}

            {data.warnings.length > 0 && (
              <ul className="space-y-0.5 text-3xs text-warn">
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}

            {data.available && profile && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-3xs text-ink-faint">
                <span className="text-ink-dim">{profile.bins.length} price rows</span>
                <span className="text-ink-dim">{fmtCompact(profile.totalVolume)} contracts</span>
                <span className={changeClass(profile.delta)}>delta {fmtSigned(profile.delta, 0)}</span>
                <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#E0A63C]" /> POC</span>
                <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#3E8FB0]" /> VWAP</span>
                <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 bg-[#E7EAEE]" /> Last</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-3 border border-[#E0A63C]/40 bg-[#E0A63C]/10" /> value area</span>
              </div>
            )}
          </div>
        )}
      </Panel>

      {data?.available && profile && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_310px]">
          <Panel title="Volume at price" subtitle={`${profile.rowStep} point rows · shows ${rangePct ? `±${rangePct}%` : "all"} of ${profile.bins.length}`}>
            <VolumeProfileChart
              bins={visibleBins}
              spot={spot}
              vwap={data.vwap}
              poc={profile.pocPrice}
              vah={profile.valueAreaHigh}
              val={profile.valueAreaLow}
              digits={digits}
            />
          </Panel>

          <div className="flex min-h-0 flex-col gap-2">
            <Panel title="Session levels">
              <div className="space-y-0">
                <KeyValue label="Session open" value={fmt(quote?.open, digits)} />
                <KeyValue label="Session high" value={fmt(quote?.high, digits)} />
                <KeyValue label="Session low" value={fmt(quote?.low, digits)} />
                <KeyValue label="Prev close" value={fmt(quote?.prevClose, digits)} />
                <KeyValue label="VWAP" value={fmt(data.vwap, digits)} />
                <KeyValue label="POC" value={fmt(profile.pocPrice, digits)} />
                <KeyValue
                  label="Value area"
                  value={`${fmt(profile.valueAreaLow, digits)} – ${fmt(profile.valueAreaHigh, digits)}`}
                />
                <KeyValue label="Open interest" value={fmtCompact(quote?.openInterest)} />
                <KeyValue label="Trades window" value={`${data.windowHours}h · ${dateTime(data.firstTradeAt)}`} />
              </div>
            </Panel>

            <Panel title="Session statistics">
              <div className="space-y-0">
                <KeyValue label="Volume" value={fmtCompact(profile.totalVolume)} />
                <KeyValue label="Buy volume" value={<span className="text-up">{fmtCompact(profile.buyVolume)}</span>} />
                <KeyValue label="Sell volume" value={<span className="text-down">{fmtCompact(profile.sellVolume)}</span>} />
                <KeyValue
                  label="Delta"
                  value={<span className={changeClass(profile.delta)}>{fmtSigned(profile.delta, 0)}</span>}
                />
                <KeyValue label="Prints" value={fmtCompact(data.tradeCount)} />
                <KeyValue label="Last print" value={dateTime(data.lastTradeAt)} />
                <KeyValue label="Source" value={data.source} />
              </div>
            </Panel>

            <Panel title="Method">
              <p className="text-3xs leading-relaxed text-ink-faint">
                Computed only from executed trade prints archived by the NinjaTrader bridge. POC is the highest-volume
                price row; the value area covers 70% of window volume; VWAP = Σ(price × size) / Σ(size). No options data
                and no synthetic values are used.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
