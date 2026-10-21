"use client";

import { useState } from "react";
import { useApi } from "@/lib/client/hooks";
import { apiPost } from "@/lib/client/api";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { cn, fmt, dateTime } from "@/lib/utils";

interface PortfolioDTO {
  accounts: { id: string; label: string; broker: string; account_ref: string; base_currency: string; mode: string }[];
  positions: { id: string; symbol: string; assetClass: string; quantity: number; avg_price: number; last: number | null; marketValue: number | null; unrealizedPnl: number | null; priceStatus: string }[];
  trades: { id: string; symbol: string; side: string; quantity: number; price: number; realized_pnl: number | null; executed_at: string }[];
  summary: { marketValue: number; unrealizedPnl: number; realizedPnl: number; currency: string };
}

export default function PortfolioPage() {
  const { data, error, reload } = useApi<PortfolioDTO>("/portfolio", { pollMs: 20000 });
  const [label, setLabel] = useState("Demo Account");
  const [broker, setBroker] = useState("Manual");
  const [ref, setRef] = useState("ACC-001");
  const [status, setStatus] = useState<string | null>(null);

  const [posSymbol, setPosSymbol] = useState("SPY");
  const [posQty, setPosQty] = useState("100");
  const [posPrice, setPosPrice] = useState("450");

  async function createAccount() {
    setStatus(null);
    try {
      await apiPost("/portfolio", { action: "create_account", label, broker, accountRef: ref });
      setStatus("Account created.");
      reload();
    } catch (e) { setStatus(e instanceof Error ? e.message : "Failed."); }
  }

  async function addPosition() {
    const accountId = data?.accounts[0]?.id;
    if (!accountId) { setStatus("Create an account first."); return; }
    try {
      await apiPost("/portfolio", { action: "add_position", accountId, symbol: posSymbol, quantity: Number(posQty), price: Number(posPrice) });
      setStatus("Position recorded.");
      reload();
    } catch (e) { setStatus(e instanceof Error ? e.message : "Failed."); }
  }

  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="flex flex-col gap-2">
        <Panel title="Accounts" subtitle="read-only monitoring">
          {!data?.accounts.length && <EmptyState title="No accounts" hint="Create a read-only account to track positions. Execution is never enabled here." />}
          <div className="space-y-0.5">
            {data?.accounts.map((a) => (
              <div key={a.id} className="border border-line/60 px-2 py-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink">{a.label}</span>
                  <span className="font-mono text-3xs uppercase text-info">{a.mode}</span>
                </div>
                <div className="font-mono text-3xs text-ink-faint">{a.broker} · {a.account_ref} · {a.base_currency}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Add account" subtitle="manual / read-only">
          <div className="grid grid-cols-3 gap-1">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="col-span-3 border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
            <input value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="Broker" className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Ref" className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
            <button onClick={createAccount} className="border border-amber/50 bg-amber/10 px-1 py-1 font-mono text-2xs uppercase text-amber hover:bg-amber/20">Add</button>
          </div>
        </Panel>

        <Panel title="Record position" subtitle="manual entry">
          <div className="grid grid-cols-3 gap-1">
            <input value={posSymbol} onChange={(e) => setPosSymbol(e.target.value.toUpperCase())} placeholder="Symbol" className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
            <input value={posQty} onChange={(e) => setPosQty(e.target.value)} placeholder="Qty" className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
            <input value={posPrice} onChange={(e) => setPosPrice(e.target.value)} placeholder="Price" className="border border-line-2 bg-base px-1.5 py-1 font-mono text-2xs text-ink outline-none focus:border-amber" />
          </div>
          <button onClick={addPosition} className="mt-1 w-full border border-line-2 bg-panel-2 px-1 py-1 font-mono text-2xs uppercase text-ink-dim hover:border-amber hover:text-amber">Add position</button>
          {status && <p className="mt-1 text-3xs text-ink-faint">{status}</p>}
        </Panel>
      </div>

      <div className="flex flex-col gap-2 xl:col-span-2">
        <Panel title="Portfolio summary" subtitle="mark-to-market from latest quotes">
          {error && <ErrorState message={error.message} onRetry={reload} />}
          <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-4">
            <KeyValue label="Market value" value={fmt(data?.summary.marketValue ?? 0, 2)} />
            <KeyValue label="Unrealized P&L" value={<span className={cn((data?.summary.unrealizedPnl ?? 0) >= 0 ? "text-up" : "text-down")}>{fmt(data?.summary.unrealizedPnl ?? 0, 2)}</span>} />
            <KeyValue label="Realized P&L" value={<span className={cn((data?.summary.realizedPnl ?? 0) >= 0 ? "text-up" : "text-down")}>{fmt(data?.summary.realizedPnl ?? 0, 2)}</span>} />
            <KeyValue label="Currency" value={data?.summary.currency ?? "USD"} />
          </div>
        </Panel>

        <Panel title="Open positions" subtitle="live mark">
          {!data?.positions.length && <EmptyState title="No open positions" />}
          {!!data?.positions.length && (
            <div className="overflow-auto border border-line">
              <table className="w-full border-collapse text-right font-mono text-2xs">
                <thead className="sticky top-0 bg-panel-2 text-3xs uppercase text-ink-faint">
                  <tr>{["Sym", "Qty", "Avg", "Last", "Mkt val", "uP&L", "Status"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.id} className="border-b border-line/50">
                      <td className="px-2 py-[3px] text-left text-amber">{p.symbol}</td>
                      <td className="px-2 py-[3px] tabular">{p.quantity}</td>
                      <td className="px-2 py-[3px] tabular">{fmt(p.avg_price, 2)}</td>
                      <td className="px-2 py-[3px] tabular">{fmt(p.last, 2)}</td>
                      <td className="px-2 py-[3px] tabular">{fmt(p.marketValue, 2)}</td>
                      <td className={cn("px-2 py-[3px] tabular", (p.unrealizedPnl ?? 0) >= 0 ? "text-up" : "text-down")}>{fmt(p.unrealizedPnl, 2)}</td>
                      <td className="px-2 py-[3px] text-left"><StatusBadge status={p.priceStatus as never} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Trade history" subtitle="manual ledger">
          {!data?.trades.length && <EmptyState title="No trades" />}
          {!!data?.trades.length && (
            <div className="max-h-64 overflow-auto border border-line">
              <table className="w-full border-collapse text-right font-mono text-2xs">
                <thead className="sticky top-0 bg-panel-2 text-3xs uppercase text-ink-faint">
                  <tr>{["Time", "Sym", "Side", "Qty", "Price", "rP&L"].map((h) => <th key={h} className="px-2 py-1">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.trades.map((t) => (
                    <tr key={t.id} className="border-b border-line/50">
                      <td className="px-2 py-[3px] text-left text-ink-faint">{dateTime(t.executed_at)}</td>
                      <td className="px-2 py-[3px] text-left text-amber">{t.symbol}</td>
                      <td className="px-2 py-[3px] uppercase">{t.side}</td>
                      <td className="px-2 py-[3px] tabular">{t.quantity}</td>
                      <td className="px-2 py-[3px] tabular">{fmt(t.price, 2)}</td>
                      <td className={cn("px-2 py-[3px] tabular", (t.realized_pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{fmt(t.realized_pnl, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}