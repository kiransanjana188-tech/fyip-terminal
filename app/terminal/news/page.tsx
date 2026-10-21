"use client";

import { NewsWire } from "@/components/terminal/NewsWire";

export default function NewsPage() {
  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <div className="border border-line bg-panel-2 px-2.5 py-1.5">
        <h1 className="font-mono text-2xs uppercase tracking-widest text-amber">NEWS</h1>
        <p className="mt-0.5 text-3xs text-ink-faint">
          Prioritised wire with transparent priority rules. Priority is derived from an explicit source classification or the
          documented FYIP rules engine — it is never invented.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <NewsWire />
      </div>
    </div>
  );
}