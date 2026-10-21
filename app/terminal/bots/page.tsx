"use client";

import { useState } from "react";
import { useApi } from "@/lib/client/hooks";
import { apiPost } from "@/lib/client/api";
import { Panel } from "@/components/ui/Panel";
import { EmptyState, ErrorState, BlockerNote } from "@/components/ui/States";
import { dateTime } from "@/lib/utils";

interface BotsDTO {
  executionEnabled: boolean;
  executionNote: string;
  bots: { id: string; label: string; platform: string; strategy: string | null; version: string | null; enabled: number; exec_enabled: number; last_heartbeat: string | null; state: string; events: { id: string; at: string; level: string; event_type: string; message: string }[] }[];
}

export default function BotsPage() {
  const { data, error, reload } = useApi<BotsDTO>("/bots", { pollMs: 20000 });
  const [label, setLabel] = useState("FYP Scalper");
  const [platform, setPlatform] = useState("MT5");
  const [strategy, setStrategy] = useState("mean-reversion");
  const [status, setStatus] = useState<string | null>(null);

  async function register() {
    try {
      await apiPost("/bots", { label, platform, strategy });
      setStatus("Bot registered.");
      reload();
    } catch (e) { setStatus(e instanceof Error ? e.message : "Failed (requires bots.control)."); }
  }

  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="flex flex-col gap-2 xl:col-span-2">
        <Panel title="FYP Bot monitor" subtitle="read-only">
          <BlockerNote>{data?.executionNote ?? "Remote execution is disabled. Monitoring only."}</BlockerNote>
          {error && <ErrorState message={error.message} onRetry={reload} />}
          {(!data || data.bots.length === 0) && (
            <EmptyState title="No bots registered" hint="Register a bot to track its state, heartbeats and logs. Execution remains disabled until independently secured." />
          )}
          <div className="mt-2 space-y-2">
            {data?.bots.map((b) => (
              <div key={b.id} className="border border-line/60 p-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink">{b.label}</span>
                  <span className="font-mono text-3xs uppercase text-info">{b.platform}</span>
                  <span className="font-mono text-3xs text-ink-faint">{b.strategy}</span>
                  <span className="ml-auto font-mono text-3xs uppercase text-ink-faint">{b.state}</span>
                </div>
                <div className="mt-1 font-mono text-3xs text-ink-faint">
                  heartbeat {b.last_heartbeat ? dateTime(b.last_heartbeat) : "never"} · exec {b.exec_enabled ? "enabled" : "disabled"}
                </div>
                {b.events.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {b.events.map((e) => (
                      <li key={e.id} className="font-mono text-3xs text-ink-dim">
                        <span className="text-ink-faint">{dateTime(e.at)}</span> [{e.level}] {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Register bot" subtitle="requires bots.control">
        <div className="space-y-1">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform (MT5/NinjaTrader)" className="w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
          <input value={strategy} onChange={(e) => setStrategy(e.target.value)} placeholder="Strategy" className="w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </div>
        <button onClick={register} className="mt-2 w-full border border-amber/50 bg-amber/10 px-2 py-1 font-mono text-2xs uppercase tracking-widest text-amber hover:bg-amber/20">Register</button>
        {status && <p className="mt-1 text-3xs text-ink-faint">{status}</p>}
      </Panel>
    </div>
  );
}