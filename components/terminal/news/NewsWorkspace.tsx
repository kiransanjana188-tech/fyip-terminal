"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { FypNews } from "./FypNews";
import { FinancialJuiceWidget } from "./FinancialJuiceWidget";

type NewsSource = "financialjuice" | "engine";

const SOURCES: { key: NewsSource; label: string; detail: string }[] = [
  { key: "financialjuice", label: "FINANCIALJUICE", detail: "Official provider embed" },
  { key: "engine", label: "FYIP ENGINE", detail: "Independent collected wire" },
];

export function NewsWorkspace() {
  const [source, setSource] = useState<NewsSource>("financialjuice");

  return (
    <div className="flex min-h-full flex-col gap-2 xl:h-full xl:min-h-0">
      <nav
        aria-label="News source"
        className="flex shrink-0 flex-wrap items-center gap-1.5 border border-line bg-panel px-2 py-1.5"
      >
        <span className="mr-1 font-mono text-3xs uppercase tracking-widest text-ink-faint">News source</span>
        <div role="tablist" aria-label="Choose news source" className="flex flex-wrap items-center gap-1">
          {SOURCES.map((item) => {
            const active = source === item.key;
            return (
              <button
                key={item.key}
                role="tab"
                aria-selected={active}
                aria-controls="news-panel"
                id={`news-tab-${item.key}`}
                onClick={() => setSource(item.key)}
                className={cn(
                  "flex items-center gap-1.5 border px-2 py-1 font-mono text-3xs uppercase tracking-wider",
                  active
                    ? "border-amber/50 bg-amber/10 text-amber"
                    : "border-line-2 bg-panel-2 text-ink-faint hover:border-line-2 hover:text-ink",
                )}
                title={item.detail}
              >
                {item.label}
                <span className={cn("hidden normal-case tracking-normal sm:inline", active ? "text-amber/80" : "text-ink-faint")}>
                  {item.detail}
                </span>
              </button>
            );
          })}
        </div>
        <span className="ml-auto hidden font-mono text-3xs uppercase tracking-wider text-ink-faint md:inline">
          Provider headlines stay separate from FYIP-collected stories
        </span>
      </nav>

      <div
        id="news-panel"
        role="tabpanel"
        aria-labelledby={`news-tab-${source}`}
        className="min-h-0 flex-1"
      >
        {source === "financialjuice" ? (
          <FinancialJuiceWidget />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto">
            <FypNews />
          </div>
        )}
      </div>
    </div>
  );
}
