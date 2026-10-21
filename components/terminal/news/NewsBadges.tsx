import { cn } from "@/lib/utils";
import type {
  NewsDirectionDTO,
  NewsPriorityDTO,
  NewsVerificationDTO,
} from "@/lib/client/types";
import { VERIFICATION_LABEL } from "@/lib/news/taxonomy";

const VERIFICATION_CLASS: Record<NewsVerificationDTO, string> = {
  official: "text-up border-up/40 bg-up/10",
  corroborated: "text-info border-info/40 bg-info/10",
  "multi-source": "text-info border-info/40 bg-info/10",
  "single-source": "text-warn border-warn/40 bg-warn/10",
  unverified: "text-down border-down/40 bg-down/10",
};

const PRIORITY_CLASS: Record<NewsPriorityDTO, string> = {
  breaking: "text-down border-down/50 bg-down/10",
  high: "text-amber border-amber/40 bg-amber/10",
  scheduled: "text-info border-info/40 bg-info/10",
  market: "text-violet border-violet/40 bg-violet/10",
  research: "text-ink-dim border-line-2 bg-panel-2",
  general: "text-ink-faint border-line bg-panel",
};

export function Badge({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded-sm border px-1 py-[1px] font-mono text-3xs uppercase tracking-wider",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function VerificationBadge({ value }: { value: NewsVerificationDTO }) {
  return (
    <Badge
      className={VERIFICATION_CLASS[value]}
      title={
        value === "official"
          ? "Published by an official primary source registered in FYP NEWS."
          : value === "corroborated"
            ? "Three or more independent providers in this module reported the event. This is not independent legal confirmation."
            : value === "multi-source"
              ? "Two independent providers reported the event. Repetition by the same provider is not independent confirmation."
              : value === "unverified"
                ? "The source language itself signals uncertainty (reportedly / unconfirmed / claims)."
                : "Only one provider in this module has reported this item."
      }
    >
      {VERIFICATION_LABEL[value]}
    </Badge>
  );
}

export function PriorityBadge({ value }: { value: NewsPriorityDTO }) {
  return <Badge className={PRIORITY_CLASS[value]}>{value}</Badge>;
}

export function DirectionBadge({ value }: { value: NewsDirectionDTO }) {
  const map: Record<NewsDirectionDTO, string> = {
    up: "text-up border-up/40 bg-up/10",
    down: "text-down border-down/40 bg-down/10",
    "two-way": "text-warn border-warn/40 bg-warn/10",
    watch: "text-ink-dim border-line-2 bg-panel-2",
  };
  return <Badge className={map[value]}>{value === "two-way" ? "TWO-WAY" : value}</Badge>;
}

export function SourceStatusDot({ status }: { status: string }) {
  const color =
    status === "ok"
      ? "bg-up"
      : status === "error"
        ? "bg-down"
        : status === "stale"
          ? "bg-warn"
          : status === "unavailable"
            ? "bg-ink-faint"
            : "bg-info";
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", color)} aria-hidden />;
}
