import { cn } from "@/lib/utils";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  dense?: boolean;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line bg-panel-2 px-2.5 py-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate font-mono text-2xs uppercase tracking-widest text-ink-dim">{title}</h2>
            {subtitle && <span className="truncate text-3xs text-ink-faint">{subtitle}</span>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1", dense ? "" : "p-2.5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function KeyValue({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1">
      <span className="text-3xs uppercase tracking-wider text-ink-faint">{label}</span>
      <span className={cn("text-right text-xs text-ink", mono && "font-mono tabular")}>{value}</span>
    </div>
  );
}