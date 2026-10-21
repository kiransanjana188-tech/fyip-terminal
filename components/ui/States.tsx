import { cn } from "@/lib/utils";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 font-mono text-2xs uppercase tracking-widest text-ink-faint">
      <span className="inline-block h-2 w-2 animate-blink rounded-full bg-amber" aria-hidden />
      {label}…
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-2 border border-down/40 bg-down/5 p-3">
      <span className="font-mono text-2xs uppercase tracking-widest text-down">Error</span>
      <p className="text-xs text-ink-dim">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="w-fit border border-line-2 bg-panel-2 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, className }: { title: string; hint?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 p-6 text-center", className)}>
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-faint">{title}</span>
      {hint && <p className="max-w-lg text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export function BlockerNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border border-warn/30 bg-warn/5 p-2.5 text-xs text-ink-dim", className)}>
      <span className="mr-1.5 font-mono text-3xs uppercase tracking-widest text-warn">Dependency</span>
      {children}
    </div>
  );
}