"use client";

import { useState } from "react";
import { useApi } from "@/lib/client/hooks";
import { UNIVERSE } from "@/lib/client/universe";
import type { QuoteView } from "@/lib/client/types";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Loading, ErrorState, EmptyState, BlockerNote } from "@/components/ui/States";
import { QuoteGrid } from "@/components/terminal/QuoteGrid";
import { useTerminal } from "@/components/terminal/context";
import { fmt, fmtPct } from "@/lib/utils";

interface CompanyDTO {
  instrument: { id: string; symbol: string; display_name: string; asset_class: string; currency: string };
  quote: QuoteView;
  profile: { legal_name: string; sector: string | null; industry: string | null; country: string | null; source: string } | null;
  financials: unknown[];
  financialsAvailable: boolean;
  financialsBlocker: string | null;
  filings: unknown[];
  filingsBlocker: string | null;
}

export default function EquitiesPage() {
  const { linkedSymbol, setLinkedSymbol } = useTerminal();
  const symbol = UNIVERSE.equities.includes(linkedSymbol as never) ? linkedSymbol : "AAPL";
  const [input, setInput] = useState(symbol);
  const { data, error, loading, reload } = useApi<CompanyDTO>(`/companies/${encodeURIComponent(input)}`);

  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="flex flex-col gap-2 xl:col-span-1">
        <Panel
          title="Company lookup"
          actions={
            <button onClick={reload} className="font-mono text-3xs uppercase tracking-wider text-ink-faint hover:text-amber">reload</button>
          }
        >
          <div className="flex gap-1">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") setLinkedSymbol(input); }}
              className="w-full border border-line-2 bg-base px-2 py-1 font-mono text-xs text-ink outline-none focus:border-amber"
              placeholder="e.g. NVDA"
            />
            <button
              onClick={() => setLinkedSymbol(input)}
              className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-2xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber"
            >
              Load
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {UNIVERSE.equities.map((s) => (
              <button key={s} onClick={() => { setInput(s); setLinkedSymbol(s); }} className="border border-line px-1.5 py-0.5 font-mono text-3xs text-ink-faint hover:border-amber hover:text-amber">
                {s}
              </button>
            ))}
          </div>
        </Panel>

        {loading && !data && <Loading label="Loading company" />}
        {error && <ErrorState message={error.message} onRetry={reload} />}

        {data && (
          <>
            <Panel title="Quote" subtitle={data.quote?.provider ?? "source"}>
              {data.quote && (
                <div className="space-y-0.5">
                  <KeyValue label="Symbol" value={data.instrument.symbol} />
                  <KeyValue label="Last" value={fmt(data.quote.last, data.quote.priceScale)} />
                  <KeyValue label="Change" value={`${fmt(data.quote.change, data.quote.priceScale)} (${fmtPct(data.quote.changePct)})`} />
                  <KeyValue label="Bid / Ask" value={`${fmt(data.quote.bid, data.quote.priceScale)} / ${fmt(data.quote.ask, data.quote.priceScale)}`} />
                  <KeyValue label="Currency" value={data.instrument.currency} />
                  <div className="flex items-center justify-between py-1">
                    <span className="text-3xs uppercase tracking-wider text-ink-faint">Data status</span>
                    <StatusBadge status={data.quote.dataStatus} />
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Profile" subtitle={data.profile ? data.profile.source : "unavailable"}>
              {data.profile ? (
                <div className="space-y-0.5">
                  <KeyValue label="Legal name" value={data.profile.legal_name} />
                  <KeyValue label="Sector" value={data.profile.sector ?? "—"} />
                  <KeyValue label="Industry" value={data.profile.industry ?? "—"} />
                  <KeyValue label="Country" value={data.profile.country ?? "—"} />
                </div>
              ) : (
                <EmptyState title="No profile" hint="Only reference metadata is seeded; fundamentals require a provider." />
              )}
            </Panel>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 xl:col-span-2">
        <div className="h-72">
          <QuoteGrid title="Equity watchlist" symbols={[...UNIVERSE.equities]} />
        </div>
        {data && (
          <>
            <Panel title="Financial statements" subtitle="income / balance / cash flow">
              {!data.financialsAvailable && (
                <BlockerNote>{data.financialsBlocker} Statements preserve period, unit, currency, source and filing timestamp when present.</BlockerNote>
              )}
            </Panel>
            <Panel title="Filings & documents" subtitle="regulatory index">
              {data.filings.length === 0 && <BlockerNote>{data.filingsBlocker}</BlockerNote>}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}