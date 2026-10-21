"use client";

import { useState } from "react";
import { VolumeSurface } from "@/components/analytics/VolumeSurface";
import { Panel } from "@/components/ui/Panel";
import { BlockerNote, EmptyState, ErrorState, Loading } from "@/components/ui/States";
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
const BUCKETS = [
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
];
const ROW_TICKS = [
  { value: 1, label: "1 tick" },
  { value: 2, label: "2 ticks" },
  { value: 4, label: "4 ticks" },
  { value: 8, label: "8 ticks" },
];

const selectClass =
  "border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber";

export default function VolumeSurfacePage() {
  const [symbol, setSymbol] = useState("ESZ6");
  const [hours, setHours] = useState(24);
  const [bucketMinutes, setBucketMinutes] = useState(15);
  const [rowTicks, setRowTicks] = useState(4);

  const { data, error, loading, reload } = useApi<FuturesAnalyticsResponse>("/futures/analytics", {
    params: { symbol, hours, bucketMinutes, rowTicks },
    pollMs: 30000,
  });

  const quote = data?.quote ?? null;
  const surface = data?.surface ?? null;
  const digits = data?.priceScale ?? 2;
  const changeClass = (value: number | null) =>
    value === null || value === 0 ? "text-ink-dim" : value > 0 ? "text-up" : "text-down";

  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <Panel
        title="3D volume surface"
        subtitle="time × price × traded volume · futures-only"
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
              <span className="text-3xs uppercase tracking-wider text-ink-faint">Bucket</span>
              <select
                value={bucketMinutes}
                onChange={(e) => setBucketMinutes(Number(e.target.value))}
                className={selectClass}
              >
                {BUCKETS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <span className="text-3xs uppercase tracking-wider text-ink-faint">Row</span>
              <select value={rowTicks} onChange={(e) => setRowTicks(Number(e.target.value))} className={selectClass}>
                {ROW_TICKS.map((r) => (
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
        {!error && loading && !data && <Loading label="Loading volume surface" />}
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
                    {fmtCompact(data.tradeCount)} prints · {surface ? `${surface.buckets.length} × ${surface.prices.length} grid` : "no grid"}
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
          </div>
        )}
      </Panel>

      <Panel
        title="Volume surface"
        subtitle={surface ? `${surface.bucketMinutes} minute buckets · ${surface.rowStep} point rows` : undefined}
        className="min-h-[420px] flex-1"
        bodyClassName="p-0"
        dense
      >
        {error && <ErrorState message={error.message} onRetry={reload} />}
        {!error && loading && !data && <Loading label="Loading volume surface" />}
        {data && !surface && (
          <EmptyState
            title="No surface yet"
            hint={data.reason ?? "Trade prints are required to build a time × price volume surface."}
          />
        )}
        {surface && <VolumeSurface surface={surface} digits={digits} className="h-[560px]" />}
      </Panel>

      <p className="px-1 text-3xs text-ink-faint">
        Height and color come only from executed prints: height is traded contracts in each time × price cell, color
        shifts teal for buy-dominant cells and red for sell-dominant cells. This is not gamma exposure and involves no
        options data.
      </p>
    </div>
  );
}
