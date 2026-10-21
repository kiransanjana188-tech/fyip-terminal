"use client";

import Link from "next/link";
import { MODULE_BY_KEY, ModuleStatus, STATUS_LABEL, STATUS_CLASS } from "@/lib/modules";
import { Panel, KeyValue } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";

/**
 * Honest status page for modules whose data pipeline is not yet wired.
 * States exactly what the module does, what it needs, and where it will live.
 * This is a labelled placeholder — never a fake implementation.
 */
export function ModuleScaffold({ moduleKey }: { moduleKey: string }) {
  const mod = MODULE_BY_KEY.get(moduleKey);
  if (!mod) {
    return <div className="p-4 text-sm text-down">Unknown module: {moduleKey}</div>;
  }
  const status: ModuleStatus = mod.status;
  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <div className="border border-line bg-panel-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-sm tracking-widest text-amber">{mod.key}</h1>
          <span className="text-xs text-ink-dim">{mod.title}</span>
          <span className={cn("ml-auto rounded-sm border px-1.5 py-[1px] font-mono text-3xs tracking-wider", STATUS_CLASS[status])}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs text-ink-faint">{mod.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title="Implementation status">
          <div className="space-y-0.5">
            <KeyValue label="Command" value={mod.key} />
            <KeyValue label="Route" value={mod.path} />
            <KeyValue label="Group" value={mod.group} />
            <KeyValue label="Permission" value={mod.permission ?? "any authenticated user"} />
          </div>
        </Panel>

        <Panel title="Dependency to reach IMPLEMENTED">
          <p className="text-xs text-ink-dim">
            {mod.dependency ?? "No external dependency identified."}
          </p>
          <p className="mt-2 text-3xs text-ink-faint">
            FYIP never fabricates data to fill a module. Until the dependency is satisfied this module is
            intentionally routed but inactive.
          </p>
        </Panel>
      </div>

      <Panel title="What lands here">
        <ul className="list-inside list-disc space-y-1 text-xs text-ink-dim">
          <li>Fully typed data contracts and provider adapter hooks.</li>
          <li>Loading, empty, stale, disconnected and error states.</li>
          <li>Source, entitlement and freshness labelling on every value.</li>
          <li>Alert and workspace integration with the shared instrument master.</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/terminal/admin" className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-2xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber">
            Configure providers
          </Link>
          <Link href="/terminal" className="border border-line-2 bg-panel-2 px-2 py-1 font-mono text-2xs uppercase tracking-wider text-ink-dim hover:border-amber hover:text-amber">
            Back to overview
          </Link>
        </div>
      </Panel>
    </div>
  );
}