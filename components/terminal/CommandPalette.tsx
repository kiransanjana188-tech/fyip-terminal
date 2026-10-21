"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MODULES, type ModuleDef } from "@/lib/modules";
import { ModuleStatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";

const RECENT_KEY = "fyip.recent-commands";

function score(module: ModuleDef, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const key = module.key.toLowerCase();
  const title = module.title.toLowerCase();
  if (key === q) return 100;
  if (key.startsWith(q)) return 80;
  if (title.startsWith(q)) return 60;
  if (key.includes(q)) return 40;
  if (title.includes(q)) return 30;
  if (module.aliases?.some((a) => a.toLowerCase().includes(q))) return 25;
  if (module.description.toLowerCase().includes(q)) return 10;
  // subsequence match
  let i = 0;
  for (const ch of key) if (ch === q[i]) i++;
  if (i === q.length) return 15;
  return 0;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw) setRecent(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const ranked = MODULES.map((m) => ({ m, s: score(m, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.m);
    if (query) return ranked.slice(0, 30);
    // No query: recent first, then all in registry order.
    const recentModules = recent
      .map((k) => MODULES.find((m) => m.key === k))
      .filter((m): m is ModuleDef => !!m);
    const seen = new Set(recentModules.map((m) => m.key));
    return [...recentModules, ...MODULES.filter((m) => !seen.has(m.key))];
  }, [query, recent]);

  function go(module: ModuleDef) {
    const next = [module.key, ...recent.filter((k) => k !== module.key)].slice(0, 8);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    onClose();
    router.push(module.path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = results[active];
      if (m) go(m);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[12vh]" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl border border-line-2 bg-panel shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="font-mono text-2xs text-amber">›</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Run a command or jump to a workspace…"
            className="w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="font-mono text-3xs uppercase tracking-widest text-ink-faint">Esc</span>
        </div>

        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-3 py-4 text-center font-mono text-2xs uppercase tracking-widest text-ink-faint">
              No matching command
            </li>
          )}
          {results.map((m, i) => (
            <li key={m.key}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(m)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-1.5 text-left",
                  i === active ? "bg-panel-3" : "hover:bg-panel-2",
                )}
              >
                <span className="w-16 shrink-0 font-mono text-2xs tracking-wider text-amber">{m.key}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-ink">{m.title}</span>
                  <span className="block truncate text-3xs text-ink-faint">{m.description}</span>
                </span>
                <ModuleStatusBadge status={m.status} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}