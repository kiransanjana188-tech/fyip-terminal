"use client";

import { QuoteGrid } from "@/components/terminal/QuoteGrid";
import { NewsWire } from "@/components/terminal/NewsWire";
import { EconCalendar } from "@/components/terminal/EconCalendar";
import { YouTubeLive } from "@/components/terminal/YouTubeLive";
import { useApi } from "@/lib/client/hooks";
import { UNIVERSE } from "@/lib/client/universe";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";

interface HealthDTO {
  version: string;
  time: string;
  database: { ok: boolean; migrations: number };
  quotes: { tracked: number; subscribers: number };
  feeds: { provider: string; status: string; eventCount: number; lastEventAt: string | null }[];
}

function FeedHealthPanel() {
  const { data } = useApi<HealthDTO>("/health", { pollMs: 15000 });
  return (
    <Panel title="Feed & service health" subtitle="operational status">
      <div className="space-y-0.5">
        <KeyValue label="Version" value={data?.version ?? "—"} />
        <KeyValue label="Database" value={data ? `ok · ${data.database.migrations} migrations` : "…"} />
        <KeyValue label="Quotes tracked" value={data?.quotes.tracked ?? 0} />
        <KeyValue label="SSE subscribers" value={data?.quotes.subscribers ?? 0} />
      </div>
      <div className="mt-2 border-t border-line pt-2">
        <div className="mb-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Feeds</div>
        {(!data || data.feeds.length === 0) && (
          <p className="text-3xs text-ink-faint">No active feed. Configure the NinjaTrader bridge or enable fixtures.</p>
        )}
        <ul className="space-y-1">
          {data?.feeds.map((f) => (
            <li key={f.provider} className="flex items-center justify-between gap-2">
              <span className="font-mono text-2xs text-ink-dim">{f.provider}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-3xs text-ink-faint">{f.eventCount} ev</span>
                <StatusBadge status={f.status as never} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export default function HomePage() {
  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="flex min-h-[22rem] flex-col gap-2 xl:col-span-2">
        <div className="h-64">
          <QuoteGrid title="Key futures — continuous" symbols={[...UNIVERSE.keyFutures]} />
        </div>
        <div className="flex-1">
          <QuoteGrid title="US equity indices" symbols={[...UNIVERSE.indices]} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <FeedHealthPanel />
        <YouTubeLive className="flex-1" />
      </div>

      <div className="h-[26rem] xl:col-span-2">
        <NewsWire compact />
      </div>
      <div className="h-[26rem]">
        <EconCalendar compact />
      </div>
    </div>
  );
}