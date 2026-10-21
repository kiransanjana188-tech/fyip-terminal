import { cn } from "@/lib/utils";
import type { DataStatus } from "@/lib/client/types";
import { STATUS_CLASS, STATUS_LABEL } from "@/lib/client/status";
import { STATUS_CLASS as MODULE_STATUS_CLASS, STATUS_LABEL as MODULE_STATUS_LABEL, type ModuleStatus } from "@/lib/modules";

export function StatusBadge({ status, className }: { status: DataStatus; className?: string }) {
  return (
    <span
      title={`Data status: ${STATUS_LABEL[status]}`}
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-[1px] font-mono text-3xs tracking-wider",
        STATUS_CLASS[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ModuleStatusBadge({ status, className }: { status: ModuleStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-[1px] font-mono text-3xs tracking-wider",
        MODULE_STATUS_CLASS[status],
        className,
      )}
    >
      {MODULE_STATUS_LABEL[status]}
    </span>
  );
}

export function FixtureBadge({ className }: { className?: string }) {
  return (
    <span
      title="Synthetic development data — not a real market value"
      className={cn(
        "inline-flex items-center rounded-sm border border-violet/40 bg-violet/10 px-1.5 py-[1px] font-mono text-3xs tracking-wider text-violet",
        className,
      )}
    >
      FIXTURE
    </span>
  );
}

export function Dot({ tone = "idle" }: { tone?: "up" | "down" | "info" | "warn" | "idle" }) {
  const map = {
    up: "bg-up",
    down: "bg-down",
    info: "bg-info",
    warn: "bg-warn",
    idle: "bg-ink-faint",
  } as const;
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", map[tone])} aria-hidden />;
}