"use client";

import { useApi } from "@/lib/client/hooks";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { BlockerNote, EmptyState, ErrorState } from "@/components/ui/States";
import { fmt, fmtPct } from "@/lib/utils";

interface RiskDTO {
  ready: boolean;
  reason?: string;
  method?: Record<string, string>;
  exposures: { symbol: string; assetClass: string; quantity: number; notional: number | null; priceStatus: string }[];
  totalNotional?: number;
  byAssetClass: { assetClass: string; notional: number; weight: number }[];
  concentration: { hhi: number; topWeight: number; positions: number } | null;
  drawdown: { maxDrawdown: number } | null;
  var: { var: number; cvar: number; method: string; confidence: number; observations: number } | null;
  varBoth?: { historical: unknown; parametric: unknown };
  tradeVolatility: number | null;
  tradeStats: { trades: number; winRate: number; profitFactor: number | null; expectancy: number; grossProfit: number; grossLoss: number } | null;
}

export default function RiskPage() {
  const { data, error, reload } = useApi<RiskDTO>("/risk", { pollMs: 30000 });

  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="flex flex-col gap-2 xl:col-span-2">
        <Panel title="Risk overview" subtitle="modelled — not a guarantee">
          {error && <ErrorState message={error.message} onRetry={reload} />}
          {data && !data.ready && <BlockerNote>{data.reason}</BlockerNote>}
          {data?.ready && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              <KeyValue label="Gross notional" value={fmt(data.totalNotional ?? 0, 0)} />
              <KeyValue label="Positions" value={data.concentration?.positions ?? 0} />
              <KeyValue label="Top weight" value={fmtPct((data.concentration?.topWeight ?? 0) * 100, 1)} />
              <KeyValue label="HHI" value={fmt(data.concentration?.hhi ?? 0, 3)} />
              <KeyValue label="Max drawdown" value={data.drawdown ? fmtPct(data.drawdown.maxDrawdown * 100, 1) : "—"} />
              <KeyValue label="VaR 95%" value={data.var ? fmtPct(data.var.var * 100, 2) : "—"} />
              <KeyValue label="CVaR 95%" value={data.var ? fmtPct(data.var.cvar * 100, 2) : "—"} />
              <KeyValue label="Trade vol" value={data.tradeVolatility !== null ? fmtPct(data.tradeVolatility * 100, 2) : "—"} />
            </div>
          )}
        </Panel>

        <Panel title="Exposure by instrument">
          {!data?.exposures?.length && <EmptyState title="No exposures" hint="Record positions under PORT." />}
          {!!data?.exposures?.length && (
            <table className="w-full border-collapse text-right font-mono text-2xs">
              <thead className="text-3xs uppercase text-ink-faint">
                <tr>{["Sym", "Class", "Qty", "Notional", "Status"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.exposures.map((e) => (
                  <tr key={e.symbol} className="border-b border-line/50">
                    <td className="px-2 py-[3px] text-left text-amber">{e.symbol}</td>
                    <td className="px-2 py-[3px] text-left text-ink-dim">{e.assetClass}</td>
                    <td className="px-2 py-[3px] tabular">{e.quantity}</td>
                    <td className="px-2 py-[3px] tabular">{fmt(e.notional, 0)}</td>
                    <td className="px-2 py-[3px] text-left text-ink-faint">{e.priceStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-2">
        <Panel title="Allocation">
          {!data?.byAssetClass?.length && <EmptyState title="No allocation" />}
          {data?.byAssetClass?.map((a) => (
            <div key={a.assetClass} className="mb-1">
              <div className="flex justify-between font-mono text-3xs text-ink-dim">
                <span>{a.assetClass}</span><span>{fmtPct(a.weight * 100, 1)}</span>
              </div>
              <div className="h-1.5 bg-panel-3"><div className="h-full bg-amber" style={{ width: `${a.weight * 100}%` }} /></div>
            </div>
          ))}
        </Panel>

        <Panel title="Trade statistics" subtitle="from recorded ledger">
          {!data?.tradeStats || data.tradeStats.trades === 0 ? <EmptyState title="No trades" /> : (
            <div className="space-y-0.5">
              <KeyValue label="Trades" value={data.tradeStats.trades} />
              <KeyValue label="Win rate" value={fmtPct(data.tradeStats.winRate * 100, 1)} />
              <KeyValue label="Profit factor" value={data.tradeStats.profitFactor === null ? "—" : fmt(data.tradeStats.profitFactor, 2)} />
              <KeyValue label="Expectancy" value={fmt(data.tradeStats.expectancy, 2)} />
              <KeyValue label="Gross profit" value={fmt(data.tradeStats.grossProfit, 2)} />
              <KeyValue label="Gross loss" value={fmt(data.tradeStats.grossLoss, 2)} />
            </div>
          )}
        </Panel>

        <Panel title="Methodology">
          <ul className="space-y-1 text-3xs text-ink-faint">
            {data?.method && Object.entries(data.method).map(([k, v]) => (
              <li key={k}><span className="font-mono uppercase text-ink-dim">{k}:</span> {v}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}