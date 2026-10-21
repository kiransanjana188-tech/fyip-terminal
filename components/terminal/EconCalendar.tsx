"use client";

import { useApi } from "@/lib/client/hooks";
import type { EconEventDTO } from "@/lib/client/types";
import { FixtureBadge } from "@/components/ui/StatusBadge";
import { Loading, ErrorState, EmptyState, BlockerNote } from "@/components/ui/States";
import { cn, dateTime } from "@/lib/utils";

const IMPORTANCE_CLASS: Record<string, string> = {
  high: "bg-down/20 text-down border-down/50",
  medium: "bg-amber/20 text-amber border-amber/50",
  low: "bg-panel-3 text-ink-dim border-line-2",
};

export function EconCalendar({ compact = false }: { compact?: boolean }) {
  const { data, error, loading, reload } = useApi<{ events: EconEventDTO[]; hasRealData: boolean; fixturesIncluded: boolean }>(
    "/econ/calendar",
    { params: { limit: compact ? 8 : 200 }, pollMs: 60000 },
  );
  const events = data?.events ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line bg-panel-2 px-2.5 py-1.5">
        <h2 className="font-mono text-2xs uppercase tracking-widest text-ink-dim">Economic Calendar</h2>
        <div className="flex items-center gap-2">
          {data && !data.hasRealData && <span className="font-mono text-3xs text-warn">no provider</span>}
          {data?.fixturesIncluded && <FixtureBadge />}
          <button onClick={reload} className="font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-amber">refresh</button>
        </div>
      </header>

      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading label="Loading calendar" />}

      {data && !data.hasRealData && !compact && (
        <div className="p-2">
          <BlockerNote>
            No macro provider configured. Real scheduled events and consensus values require FRED or a licensed calendar.
            Enable <span className="font-mono">FYIP_ENABLE_FIXTURES=true</span> for clearly-labelled placeholder events (no fabricated actual/consensus values).
          </BlockerNote>
        </div>
      )}

      {data && events.length === 0 && (
        <EmptyState title="No scheduled events" hint="Connect a macro calendar provider to populate this view." />
      )}

      {events.length > 0 && (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="border-b border-line text-left font-mono text-3xs uppercase tracking-wider text-ink-faint">
                <th className="px-2 py-1">Time</th>
                <th className="px-2 py-1">Ctry</th>
                <th className="px-2 py-1">Event</th>
                {!compact && <th className="px-2 py-1">Imp</th>}
                {!compact && <th className="px-2 py-1">Unit</th>}
                <th className="px-2 py-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-line/50 hover:bg-panel-2">
                  <td className="whitespace-nowrap px-2 py-[3px] font-mono text-2xs text-ink-dim">{dateTime(e.scheduled_at)}</td>
                  <td className="px-2 py-[3px] font-mono text-2xs text-ink-dim">{e.country}</td>
                  <td className="px-2 py-[3px] text-2xs text-ink">
                    {e.indicator}
                    {e.is_fixture === 1 && <FixtureBadge className="ml-2" />}
                  </td>
                  {!compact && (
                    <td className="px-2 py-[3px]">
                      <span className={cn("rounded-sm border px-1 font-mono text-3xs uppercase", IMPORTANCE_CLASS[e.importance] ?? IMPORTANCE_CLASS.low)}>
                        {e.importance}
                      </span>
                    </td>
                  )}
                  {!compact && <td className="px-2 py-[3px] font-mono text-3xs text-ink-faint">{e.unit ?? "—"}</td>}
                  <td className="px-2 py-[3px] font-mono text-3xs text-ink-faint">{e.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}