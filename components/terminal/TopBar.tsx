"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/client/hooks";
import { apiPost } from "@/lib/client/api";
import type { AlertDTO, AlertEventDTO } from "@/lib/client/types";
import { useTerminal, can } from "./context";
import { Dot } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!now) return <span className="font-mono text-2xs text-ink-faint">--:--:--</span>;
  const utc = now.toISOString().slice(11, 19);
  const ny = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });
  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="font-mono text-2xs tabular text-ink-dim" title="New York">NY {ny}</span>
      <span className="font-mono text-2xs tabular text-ink-faint" title="UTC">UTC {utc}</span>
    </div>
  );
}

interface HealthDTO {
  feeds: { provider: string; status: string; eventCount: number; lastEventAt: string | null }[];
  quotes: { tracked: number; subscribers: number };
}

function ConnectionIndicator() {
  const { data } = useApi<HealthDTO>("/health", { pollMs: 15000 });
  if (!data) return <span className="font-mono text-2xs text-ink-faint">health…</span>;
  const live = data.feeds.filter((f) => f.status === "live" || f.status === "simulated");
  const down = data.feeds.filter((f) => f.status === "disconnected");
  const primary = live[0];
  const tone = primary ? (primary.status === "live" ? "up" : "info") : down.length ? "down" : "warn";
  return (
    <div className="flex items-center gap-1.5" title={data.feeds.map((f) => `${f.provider}: ${f.status}`).join("\n") || "no feeds"}>
      <Dot tone={tone} />
      <span className="font-mono text-2xs uppercase tracking-wider text-ink-dim">
        {primary ? `${primary.provider}` : "no feed"}
      </span>
    </div>
  );
}

function AlertCenter() {
  const { user } = useTerminal();
  const enabled = can(user, "alerts.write");
  const { data, reload } = useApi<{ alerts: AlertDTO[]; events: AlertEventDTO[] }>(enabled ? "/alerts" : null, {
    pollMs: 20000,
  });
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  const events = data?.events ?? [];
  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) reload(); }}
        className="flex items-center gap-1.5 border border-line px-2 py-1 font-mono text-2xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber"
      >
        Alerts
        <span className={cn("rounded-sm px-1", events.length ? "bg-amber/20 text-amber" : "bg-panel-3 text-ink-faint")}>
          {events.length}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 border border-line-2 bg-panel shadow-xl">
          <div className="border-b border-line px-2.5 py-1.5 font-mono text-2xs uppercase tracking-widest text-ink-dim">
            Recent alert events
          </div>
          <ul className="max-h-64 overflow-y-auto">
            {events.length === 0 && (
              <li className="px-2.5 py-3 text-center text-3xs text-ink-faint">No alerts fired yet</li>
            )}
            {events.map((e) => (
              <li key={e.id} className="border-b border-line/60 px-2.5 py-1.5">
                <div className="text-xs text-ink">{e.message}</div>
                <div className="font-mono text-3xs text-ink-faint">
                  {new Date(e.fired_at).toLocaleString()} · {e.source ?? "—"}
                </div>
              </li>
            ))}
          </ul>
          <a href="/terminal/screener" className="block px-2.5 py-1.5 text-3xs text-info hover:text-amber">
            Manage alerts →
          </a>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user } = useTerminal();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  async function logout() {
    await apiPost("/auth/logout");
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 border border-line px-2 py-1 font-mono text-2xs text-ink-dim hover:border-amber hover:text-amber"
      >
        <span className="truncate max-w-[8rem]">{user?.displayName ?? "Account"}</span>
        <span className="text-3xs text-ink-faint">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 border border-line-2 bg-panel shadow-xl">
          <div className="border-b border-line px-2.5 py-1.5">
            <div className="truncate text-xs text-ink">{user?.email}</div>
            <div className="font-mono text-3xs uppercase tracking-wider text-amber">
              {user?.roles.join(" · ") || "no role"}
            </div>
          </div>
          <button onClick={logout} className="w-full px-2.5 py-1.5 text-left text-xs text-ink-dim hover:bg-panel-2 hover:text-down">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { linkedSymbol } = useTerminal();
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b border-line bg-panel-2 px-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm tracking-[0.25em] text-amber">FYIP</span>
        <span className="hidden font-mono text-2xs tracking-[0.25em] text-ink-faint sm:inline">TERMINAL</span>
      </div>

      <button
        onClick={onOpenPalette}
        className="flex max-w-md flex-1 items-center gap-2 border border-line bg-base px-2 py-1 text-left hover:border-line-2"
        title="Command palette (Ctrl/Cmd+K)"
      >
        <span className="font-mono text-2xs text-amber">⌘K</span>
        <span className="truncate font-mono text-2xs text-ink-faint">Command palette · search commands & instruments</span>
      </button>

      <div className="hidden items-center gap-1 border border-line px-2 py-1 lg:flex">
        <span className="text-3xs uppercase tracking-wider text-ink-faint">Link</span>
        <span className="font-mono text-2xs text-amber">{linkedSymbol}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Clock />
        <ConnectionIndicator />
        <AlertCenter />
        <UserMenu />
      </div>
    </header>
  );
}