"use client";

import { EconCalendar } from "@/components/terminal/EconCalendar";
import { useApi } from "@/lib/client/hooks";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { BlockerNote } from "@/components/ui/States";

interface IndicatorsDTO {
  indicators: { country: string; indicator: string; c: number }[];
}

function MacroSeriesPanel() {
  const { data } = useApi<IndicatorsDTO>("/econ/series", { pollMs: 60000 });
  return (
    <Panel title="Ingested macro series" subtitle="observations stored">
      {(!data || data.indicators.length === 0) && (
        <BlockerNote>
          No macro observations stored. Configure FRED (FYIP_FRED_API_KEY) or another economic provider to ingest official series.
        </BlockerNote>
      )}
      <div className="mt-2">
        {data?.indicators.map((i) => (
          <KeyValue key={`${i.country}/${i.indicator}`} label={`${i.country} · ${i.indicator}`} value={`${i.c} obs`} />
        ))}
      </div>
    </Panel>
  );
}

export default function CalendarPage() {
  return (
    <div className="grid min-h-full grid-cols-1 gap-2 p-2 xl:grid-cols-3">
      <div className="min-h-[32rem] xl:col-span-2">
        <EconCalendar />
      </div>
      <div>
        <MacroSeriesPanel />
      </div>
    </div>
  );
}