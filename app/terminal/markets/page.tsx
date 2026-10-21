"use client";

import { useState } from "react";
import { QuoteGrid } from "@/components/terminal/QuoteGrid";
import { ASSET_CLASS_FILTERS } from "@/lib/client/universe";
import { cn } from "@/lib/utils";

export default function MarketsPage() {
  const [assetClass, setAssetClass] = useState("future");

  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-1 border border-line bg-panel-2 p-1.5">
        <span className="mr-1 font-mono text-3xs uppercase tracking-widest text-ink-faint">Asset class</span>
        {ASSET_CLASS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setAssetClass(f.value)}
            className={cn(
              "border px-2 py-1 font-mono text-2xs uppercase tracking-wider",
              assetClass === f.value
                ? "border-amber/50 bg-amber/10 text-amber"
                : "border-line text-ink-dim hover:border-line-2 hover:text-ink",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        <QuoteGrid key={assetClass} title={`Markets · ${assetClass.replace("_", " ")}`} symbols={null} assetClass={assetClass} />
      </div>
    </div>
  );
}