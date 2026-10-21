"use client";

import { useState } from "react";
import { useApi } from "@/lib/client/hooks";
import { apiPost } from "@/lib/client/api";
import type { QuoteView, AlertDTO, AlertEventDTO } from "@/lib/client/types";
import { ASSET_CLASS_FILTERS } from "@/lib/client/universe";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Loading, ErrorState, EmptyState } from "@/components/ui/States";
import { cn, fmt, fmtCompact, fmtPct } from "@/lib/utils";

interface ScreenerDTO { count: number; of: number; results: QuoteView[] }

function Screener() {
  const [assetClass, setAssetClass] = useState("");
  const [minChangePct, setMinChangePct] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [maxLast, setMaxLast] = useState("");
  const [sortBy, setSortBy] = useState("changePct");

  const { data, error, loading, reload } = useApi<ScreenerDTO>("/screener", {
    params: { assetClass, minChangePct, minVolume, maxLast, sortBy },
    pollMs: 20000,
  });

  return (
    <Panel
      title="Screener"
      subtitle={data ? `${data.count} / ${data.of} match` : ""}
      actions={<button onClick={reload} className="font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-amber">run</button>}
    >
      <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Asset class</span>
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber">
            <option value="">All</option>
            {ASSET_CLASS_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Min chg%</span>
          <input value={minChangePct} onChange={(e) => setMinChangePct(e.target.value)} placeholder="-5" className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Min volume</span>
          <input value={minVolume} onChange={(e) => setMinVolume(e.target.value)} placeholder="1000000" className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Max last</span>
          <input value={maxLast} onChange={(e) => setMaxLast(e.target.value)} placeholder="500" className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber">
            <option value="changePct">Change %</option>
            <option value="last">Last</option>
            <option value="volume">Volume</option>
            <option value="symbol">Symbol</option>
          </select>
        </label>
      </div>

      {error && <ErrorState message={error.message} onRetry={reload} />}
      {loading && !data && <Loading label="Screening" />}
      {data && data.results.length === 0 && (
        <EmptyState title="No matches" hint="Loosen the filters, or connect a market-data provider so instruments have values to screen." />
      )}
      {data && data.results.length > 0 && (
        <div className="max-h-[28rem] overflow-auto border border-line">
          <table className="w-full border-collapse text-right">
            <thead className="sticky top-0 bg-panel-2">
              <tr className="border-b border-line font-mono text-3xs uppercase tracking-wider text-ink-faint">
                <th className="px-2 py-1 text-left">Symbol</th>
                <th className="px-2 py-1">Last</th>
                <th className="px-2 py-1">Chg%</th>
                <th className="px-2 py-1">Vol</th>
                <th className="px-2 py-1 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => {
                const dir = r.changePct === null ? "text-ink-dim" : r.changePct > 0 ? "text-up" : "text-down";
                return (
                  <tr key={r.symbol} className="border-b border-line/50 hover:bg-panel-2">
                    <td className="px-2 py-[3px] text-left font-mono text-2xs text-amber">{r.symbol}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink">{fmt(r.last, r.priceScale)}</td>
                    <td className={cn("px-2 py-[3px] font-mono text-2xs tabular", dir)}>{fmtPct(r.changePct)}</td>
                    <td className="px-2 py-[3px] font-mono text-2xs tabular text-ink-dim">{fmtCompact(r.volume)}</td>
                    <td className="px-2 py-[3px] text-left"><StatusBadge status={r.dataStatus} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AlertsPanel() {
  const { data, error, reload } = useApi<{ alerts: AlertDTO[]; events: AlertEventDTO[]; firedNow: AlertEventDTO[] }>("/alerts", { pollMs: 15000 });
  const [name, setName] = useState("ES above 5000");
  const [symbol, setSymbol] = useState("ES1!");
  const [kind, setKind] = useState("quote_threshold");
  const [op, setOp] = useState("gt");
  const [value, setValue] = useState("5000");
  const [status, setStatus] = useState<string | null>(null);

  async function create() {
    setStatus(null);
    try {
      await apiPost("/alerts", { name, kind, target: symbol, op, value: Number(value) });
      setStatus("Alert created.");
      reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed.");
    }
  }

  async function remove(id: string) {
    await apiPost("/alerts", { action: "delete", id });
    reload();
  }

  return (
    <Panel title="Alert engine" subtitle="fires once per crossing, then re-arms">
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Symbol</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber">
            <option value="quote_threshold">Quote threshold</option>
            <option value="pct_change">% change</option>
          </select>
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Operator</span>
          <select value={op} onChange={(e) => setOp(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink-dim outline-none focus:border-amber">
            <option value="gt">&gt;</option>
            <option value="gte">&ge;</option>
            <option value="lt">&lt;</option>
            <option value="lte">&le;</option>
          </select>
        </label>
        <label className="block">
          <span className="text-3xs uppercase tracking-wider text-ink-faint">Value</span>
          <input value={value} onChange={(e) => setValue(e.target.value)} className="mt-0.5 w-full border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
        </label>
      </div>
      <button onClick={create} className="mt-2 w-full border border-amber/50 bg-amber/10 px-2 py-1 font-mono text-2xs uppercase tracking-widest text-amber hover:bg-amber/20">
        Create alert
      </button>
      {status && <p className="mt-1 text-3xs text-ink-faint">{status}</p>}
      {error && <ErrorState message={error.message} onRetry={reload} />}

      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Active alerts</div>
        {(data?.alerts.length ?? 0) === 0 && <p className="text-3xs text-ink-faint">None.</p>}
        <ul className="space-y-1">
          {data?.alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 border-b border-line/50 pb-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xs text-ink">{a.name}</span>
                <span className="block font-mono text-3xs text-ink-faint">{a.kind} · {a.target} · {a.condition}</span>
              </span>
              <span className="font-mono text-3xs uppercase" style={{ color: a.state === "triggered" ? "var(--fyip-amber)" : "var(--fyip-ink-faint)" }}>{a.state}</span>
              <button onClick={() => remove(a.id)} className="font-mono text-3xs text-ink-faint hover:text-down">del</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">Recent events</div>
        {(data?.events.length ?? 0) === 0 && <p className="text-3xs text-ink-faint">No events fired.</p>}
        <ul className="space-y-1">
          {data?.events.slice(0, 8).map((e) => (
            <li key={e.id} className="text-3xs text-ink-dim">
              <span className="font-mono text-ink-faint">{new Date(e.fired_at).toLocaleTimeString()}</span> {e.message}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export default function ScreenerPage() {
  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Screener />
      </div>
      <div>
        <AlertsPanel />
      </div>
    </div>
  );
}