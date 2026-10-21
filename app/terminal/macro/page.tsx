"use client";

import { useApi } from "@/lib/client/hooks";
import { UNIVERSE } from "@/lib/client/universe";
import type { QuoteView } from "@/lib/client/types";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BlockerNote, EmptyState } from "@/components/ui/States";
import { fmt } from "@/lib/utils";
import { EconCalendar } from "@/components/terminal/EconCalendar";

interface QuotesDTO { quotes: QuoteView[] }

function YieldCurve() {
  const { data } = useApi<QuotesDTO>("/quotes", { params: { symbols: ["US2Y", "US5Y", "US10Y", "US30Y"].join(",") }, pollMs: 30000 });
  const quotes = data?.quotes ?? [];
  const points = quotes
    .map((q, i) => ({ tenor: q.symbol.replace("US", ""), value: q.last, order: i, status: q.dataStatus }))
    .filter((p) => p.value !== null) as { tenor: string; value: number; order: number; status: QuoteView["dataStatus"] }[];

  const W = 360;
  const H = 160;
  const pad = 24;
  const values = points.map((p) => p.value);
  const min = values.length ? Math.min(...values) - 0.1 : 0;
  const max = values.length ? Math.max(...values) + 0.1 : 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, quotes.length - 1);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.order)} ${y(p.value)}`).join(" ");

  return (
    <Panel title="US Treasury yield curve" subtitle="source-tagged">
      {points.length === 0 ? (
        <EmptyState title="Yield data unavailable" hint="No provider is producing Treasury yields. Configure the bridge or a rates source." />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full">
          <path d={path} fill="none" stroke="var(--fyip-amber)" strokeWidth="1.5" />
          {points.map((p) => (
            <g key={p.tenor}>
              <circle cx={x(p.order)} cy={y(p.value)} r="2.5" fill="var(--fyip-amber)" />
              <text x={x(p.order)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--fyip-ink-dim)" fontFamily="monospace">
                {p.tenor}
              </text>
              <text x={x(p.order)} y={y(p.value) - 6} textAnchor="middle" fontSize="9" fill="var(--fyip-ink)" fontFamily="monospace">
                {fmt(p.value, 2)}
              </text>
            </g>
          ))}
        </svg>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {quotes.map((q) => (
          <span key={q.symbol} className="flex items-center gap-1 font-mono text-3xs text-ink-faint">
            {q.symbol} <StatusBadge status={q.dataStatus} />
          </span>
        ))}
      </div>
    </Panel>
  );
}

export default function MacroPage() {
  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="flex flex-col gap-2 xl:col-span-2">
        <YieldCurve />
        <Panel title="Policy rates & inflation" subtitle="official series">
          <BlockerNote>
            Current and historical policy rates, inflation and labour trends require FRED or official central-bank sources.
            Configure a macro provider in ADMIN → Providers. FYIP will not invent these values.
          </BlockerNote>
        </Panel>
        <Panel title="Cross-asset macro monitor" subtitle="linked instruments">
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {[...UNIVERSE.indices, ...UNIVERSE.fx, ...UNIVERSE.rates].map((s) => (
              <div key={s} className="flex items-center justify-between border border-line/60 px-2 py-1">
                <span className="font-mono text-2xs text-amber">{s}</span>
                <span className="font-mono text-3xs text-ink-faint">linked</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <div className="min-h-[32rem]">
        <EconCalendar />
      </div>
    </div>
  );
}