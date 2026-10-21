"use client";

import { useState } from "react";
import { useApi } from "@/lib/client/hooks";
import { apiPatch } from "@/lib/client/api";
import type { ProviderDTO } from "@/lib/client/types";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { cn, dateTime } from "@/lib/utils";

type Tab = "providers" | "users" | "audit" | "feeds";

function Providers() {
  const { data, error, loading, reload } = useApi<{ providers: ProviderDTO[] }>("/admin/providers");
  async function toggle(key: string, enabled: boolean) {
    await apiPatch("/admin/providers", { key, enabled });
    reload();
  }
  return (
    <Panel title="Data providers" subtitle="capabilities & configuration state">
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading />}
      <div className="space-y-1">
        {data?.providers.map((p) => (
          <div key={p.key} className="border border-line/60 p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xs text-amber">{p.key}</span>
              <span className="text-xs text-ink">{p.label}</span>
              <span className="font-mono text-3xs uppercase text-ink-faint">{p.kind}</span>
              <span className={cn("ml-auto rounded-sm border px-1.5 py-[1px] font-mono text-3xs", p.configured ? "border-up/40 bg-up/10 text-up" : "border-down/40 bg-down/10 text-down")}>
                {p.configured ? "CONFIGURED" : "NOT CONFIGURED"}
              </span>
              <button onClick={() => toggle(p.key, !p.enabledInDb)} className="border border-line-2 px-1.5 py-[1px] font-mono text-3xs uppercase text-ink-dim hover:border-amber hover:text-amber">
                {p.enabledInDb ? "disable" : "enable"}
              </button>
            </div>
            {p.blocker && <p className="mt-1 text-3xs text-warn">{p.blocker}</p>}
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(p.capabilities).filter(([, v]) => v === true).map(([k]) => (
                <span key={k} className="rounded-sm bg-panel-3 px-1 font-mono text-3xs text-ink-faint">{k}</span>
              ))}
              {typeof p.capabilities.entitlement === "string" && (
                <span className="rounded-sm bg-panel-3 px-1 font-mono text-3xs text-info">{p.capabilities.entitlement as string}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Users() {
  const { data, error, loading, reload } = useApi<{ users: { id: string; email: string; display_name: string; status: string; roles: string[] }[]; availableRoles: string[] }>("/admin/users");
  async function setRole(userId: string, role: string) {
    await apiPatch("/admin/users", { userId, role });
    reload();
  }
  async function setStatus(userId: string, enabled: boolean) {
    await apiPatch("/admin/users", { userId, enabled });
    reload();
  }
  return (
    <Panel title="Users & roles" subtitle="server-enforced RBAC">
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading />}
      <table className="w-full border-collapse font-mono text-2xs">
        <thead className="text-3xs uppercase text-ink-faint">
          <tr className="text-left">{["Email", "Name", "Roles", "Status", "Actions"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr>
        </thead>
        <tbody>
          {data?.users.map((u) => (
            <tr key={u.id} className="border-b border-line/50">
              <td className="px-2 py-[3px] text-ink">{u.email}</td>
              <td className="px-2 py-[3px] text-ink-dim">{u.display_name}</td>
              <td className="px-2 py-[3px]">
                <select value={u.roles[0] ?? ""} onChange={(e) => setRole(u.id, e.target.value)} className="border border-line-2 bg-base px-1 py-0.5 text-3xs text-amber outline-none">
                  {data.availableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td className="px-2 py-[3px]">{u.status}</td>
              <td className="px-2 py-[3px]">
                <button onClick={() => setStatus(u.id, u.status !== "active")} className="text-3xs text-ink-faint hover:text-amber">
                  {u.status === "active" ? "disable" : "enable"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Audit() {
  const { data, error, loading, reload } = useApi<{ logs: { id: number; at: string; actor_email: string | null; action: string; target: string | null; status: string }[] }>("/admin/audit", { pollMs: 20000 });
  return (
    <Panel title="Audit log" subtitle="immutable operation trail">
      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data?.logs.length === 0 && <EmptyState title="No audit records" />}
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full border-collapse font-mono text-2xs">
          <thead className="sticky top-0 bg-panel-2 text-3xs uppercase text-ink-faint">
            <tr className="text-left">{["Time", "Actor", "Action", "Target", "Status"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr>
          </thead>
          <tbody>
            {data?.logs.map((l) => (
              <tr key={l.id} className="border-b border-line/50">
                <td className="px-2 py-[3px] text-ink-faint">{dateTime(l.at)}</td>
                <td className="px-2 py-[3px] text-ink-dim">{l.actor_email ?? "—"}</td>
                <td className="px-2 py-[3px] text-amber">{l.action}</td>
                <td className="px-2 py-[3px] text-ink-dim">{l.target ?? "—"}</td>
                <td className={cn("px-2 py-[3px]", l.status === "success" ? "text-up" : "text-down")}>{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Feeds() {
  const health = useApi<{ feeds: { provider: string; status: string; eventCount: number; lastEventAt: string | null }[]; quotes: { tracked: number; subscribers: number } }>("/health", { pollMs: 10000 });
  const bridge = useApi<{ configured: boolean; feed: { status: string; lastEventAt: string | null; eventCount: number }; installations: unknown[] }>("/bridge/status", { pollMs: 10000 });
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      <Panel title="Feed health" subtitle="per provider">
        {health.data?.feeds.length === 0 && <EmptyState title="No feeds" hint="Configure the bridge or enable fixtures." />}
        {health.data?.feeds.map((f) => (
          <div key={f.provider} className="flex items-center justify-between border-b border-line/50 py-1">
            <span className="font-mono text-2xs text-ink-dim">{f.provider}</span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-3xs text-ink-faint">{f.eventCount} events</span>
              <span className="font-mono text-3xs text-ink-faint">{f.lastEventAt ? new Date(f.lastEventAt).toLocaleTimeString() : "—"}</span>
              <StatusBadge status={f.status as never} />
            </span>
          </div>
        ))}
      </Panel>
      <Panel title="NinjaTrader bridge" subtitle="ingestion status">
        <div className="space-y-1 font-mono text-2xs text-ink-dim">
          <div className="flex justify-between"><span>Configured</span><span>{bridge.data?.configured ? "yes" : "no"}</span></div>
          <div className="flex justify-between"><span>Feed status</span><span>{bridge.data?.feed.status ?? "—"}</span></div>
          <div className="flex justify-between"><span>Events received</span><span>{bridge.data?.feed.eventCount ?? 0}</span></div>
          <div className="flex justify-between"><span>Installations</span><span>{bridge.data?.installations.length ?? 0}</span></div>
        </div>
        <p className="mt-2 text-3xs text-ink-faint">
          Set FYIP_BRIDGE_TOKEN and run the NinjaTrader Add-On. See docs/NINJATRADER_BRIDGE.md.
        </p>
      </Panel>
    </div>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: "providers", label: "Providers" },
  { key: "users", label: "Users" },
  { key: "audit", label: "Audit" },
  { key: "feeds", label: "Feeds" },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("providers");
  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <div className="flex items-center gap-1 border border-line bg-panel-2 p-1.5">
        <span className="mr-1 font-mono text-3xs uppercase tracking-widest text-amber">ADMIN</span>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn("border px-2 py-1 font-mono text-2xs uppercase tracking-wider", tab === t.key ? "border-amber/50 bg-amber/10 text-amber" : "border-line text-ink-dim hover:text-ink")}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "providers" && <Providers />}
        {tab === "users" && <Users />}
        {tab === "audit" && <Audit />}
        {tab === "feeds" && <Feeds />}
      </div>
    </div>
  );
}