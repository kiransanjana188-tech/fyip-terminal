"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { moduleGroups } from "@/lib/modules";
import { useTerminal, can } from "./context";
import { Dot } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";

export function Sidebar({ open }: { open: boolean }) {
  const pathname = usePathname();
  const { user } = useTerminal();
  const groups = moduleGroups();

  return (
    <nav
      aria-label="Workspaces"
      className={cn(
        "shrink-0 overflow-y-auto border-r border-line bg-panel transition-all",
        open ? "w-52" : "w-0 overflow-hidden border-r-0",
      )}
    >
      <div className="py-1">
        {groups.map(({ group, modules }) => {
          const visible = modules.filter((m) => !m.permission || can(user, m.permission));
          if (visible.length === 0) return null;
          return (
            <div key={group} className="mb-1">
              <div className="px-3 pb-0.5 pt-2 font-mono text-3xs uppercase tracking-widest text-ink-faint">
                {group}
              </div>
              <ul>
                {visible.map((m) => {
                  const active = pathname === m.path;
                  const tone = m.status === "implemented" ? "up" : m.status === "blocked" ? "down" : "warn";
                  return (
                    <li key={m.key}>
                      <Link
                        href={m.path}
                        className={cn(
                          "flex items-center gap-2 px-3 py-[3px] text-xs",
                          active ? "bg-panel-3 text-amber" : "text-ink-dim hover:bg-panel-2 hover:text-ink",
                        )}
                        title={`${m.key} — ${m.description}`}
                      >
                        <Dot tone={tone as "up" | "warn" | "down"} />
                        <span className="w-14 shrink-0 font-mono text-2xs tracking-wider">{m.key}</span>
                        <span className="truncate">{m.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}