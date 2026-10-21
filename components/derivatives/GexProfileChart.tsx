"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GexProfile } from "@/lib/finance/gex-workspace";
import { clamp, cn, fmt, fmtCompact, fmtSigned } from "@/lib/utils";

interface Props {
  label: "A" | "B";
  profile: GexProfile;
  strikes: number[];
  fullStrikes: number[];
  hoveredStrike: number | null;
  onHover: (strike: number | null) => void;
  onViewport: (min: number, max: number) => void;
  className?: string;
}

const MARGIN = { top: 28, right: 10, bottom: 12, left: 54 };
const ROW_HEIGHT = 13;

export function GexProfileChart({
  label,
  profile,
  strikes,
  fullStrikes,
  hoveredStrike,
  onHover,
  onViewport,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ y: number; min: number; max: number } | null>(null);
  const viewRef = useRef({ min: strikes[0] ?? 0, max: strikes[strikes.length - 1] ?? 1 });
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(Math.max(280, Math.round(next)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    viewRef.current = {
      min: strikes[0] ?? 0,
      max: strikes[strikes.length - 1] ?? 1,
    };
  }, [strikes]);

  const height = Math.max(300, strikes.length * ROW_HEIGHT + MARGIN.top + MARGIN.bottom);
  const plotW = Math.max(120, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(80, height - MARGIN.top - MARGIN.bottom);
  const zeroX = MARGIN.left + plotW / 2;
  const minStrike = strikes[0] ?? 0;
  const maxStrike = strikes[strikes.length - 1] ?? 1;
  const strikeSpan = Math.max(1e-9, maxStrike - minStrike);

  const rowByStrike = useMemo(() => new Map(profile.rows.map((r) => [r.strike, r])), [profile.rows]);
  const cumulative = useMemo(() => {
    const out = new Map<number, number>();
    let cum = 0;
    for (const row of profile.rows) {
      cum += row.netGex;
      out.set(row.strike, cum);
    }
    return out;
  }, [profile.rows]);

  const visibleRows = strikes.map((strike) => rowByStrike.get(strike)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const maxAbs = Math.max(1, ...visibleRows.flatMap((r) => [Math.abs(r.callGex), Math.abs(r.putGex)]));
  const barMax = Math.max(20, plotW / 2 - 14);
  const cumValues = strikes.map((s) => cumulative.get(s)).filter((v): v is number => v !== undefined);
  const maxAbsCum = Math.max(1, ...cumValues.map((v) => Math.abs(v)));

  function yForStrike(strike: number): number {
    return MARGIN.top + ((maxStrike - strike) / strikeSpan) * plotH;
  }

  function strikeForY(y: number): number {
    const raw = maxStrike - ((y - MARGIN.top) / plotH) * strikeSpan;
    let best = strikes[0] ?? 0;
    let bestDist = Infinity;
    for (const strike of strikes) {
      const dist = Math.abs(strike - raw);
      if (dist < bestDist) {
        best = strike;
        bestDist = dist;
      }
    }
    return best;
  }

  function zoom(deltaY: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localY = clientY - rect.top;
    const anchor = strikeForY(localY);
    const current = viewRef.current;
    const span = Math.max(1e-9, current.max - current.min);
    const factor = deltaY > 0 ? 1.18 : 0.85;
    const fullMin = fullStrikes[0] ?? current.min;
    const fullMax = fullStrikes[fullStrikes.length - 1] ?? current.max;
    const fullSpan = Math.max(1e-9, fullMax - fullMin);
    const nextSpan = clamp(span * factor, Math.max(3, fullSpan * 0.06), fullSpan);
    const ratio = (anchor - current.min) / span;
    let nextMin = anchor - ratio * nextSpan;
    let nextMax = nextMin + nextSpan;
    if (nextMin < fullMin) {
      nextMin = fullMin;
      nextMax = fullMin + nextSpan;
    }
    if (nextMax > fullMax) {
      nextMax = fullMax;
      nextMin = fullMax - nextSpan;
    }
    onViewport(nextMin, nextMax);
  }

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      zoomRef.current(event.deltaY, event.clientY);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, []);

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { y: event.clientY, ...viewRef.current };
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const localY = event.clientY - rect.top;
    const drag = dragRef.current;
    if (drag) {
      const span = drag.max - drag.min;
      const shift = ((drag.y - event.clientY) / plotH) * span;
      const fullMin = fullStrikes[0] ?? drag.min;
      const fullMax = fullStrikes[fullStrikes.length - 1] ?? drag.max;
      const fullSpan = Math.max(1e-9, fullMax - fullMin);
      let nextMin = drag.min + shift;
      nextMin = clamp(nextMin, fullMin, fullMax - span);
      onViewport(nextMin, nextMin + Math.min(span, fullSpan));
      onHover(null);
      return;
    }
    if (localY < MARGIN.top || localY > MARGIN.top + plotH) {
      onHover(null);
      return;
    }
    onHover(strikeForY(localY));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  const hoveredY = hoveredStrike !== null && hoveredStrike >= minStrike && hoveredStrike <= maxStrike
    ? yForStrike(hoveredStrike)
    : null;
  const hoveredRow = hoveredStrike !== null ? rowByStrike.get(hoveredStrike) : undefined;
  const hoveredCum = hoveredStrike !== null ? cumulative.get(hoveredStrike) : undefined;

  const labelEvery = Math.max(1, Math.ceil(strikes.length / Math.max(6, Math.floor(plotH / 24))));
  const cumulativePoints = strikes
    .map((strike) => {
      const value = cumulative.get(strike);
      if (value === undefined) return null;
      return `${zeroX + (value / maxAbsCum) * barMax * 0.92},${yForStrike(strike)}`;
    })
    .filter((p): p is string => p !== null)
    .join(" ");

  return (
    <div ref={containerRef} className={cn("relative min-h-0", className)}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-amber">{label}</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 bg-up" /> calls</span>
          <span className="flex items-center gap-1"><i className="h-1.5 w-3 bg-down" /> puts</span>
          <span className="flex items-center gap-1"><i className="h-[2px] w-3 bg-amber" /> cum GEX</span>
          <span className="flex items-center gap-1"><i className="h-[2px] w-3 border-t border-dashed border-amber" /> spot</span>
        </div>
        <span>wheel zoom · drag pan</span>
      </div>

      <div className="max-h-[40rem] overflow-y-auto overflow-x-hidden border border-line/70 bg-base">
        <svg
          ref={svgRef}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block touch-none select-none"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            dragRef.current = null;
            onHover(null);
          }}
          role="img"
          aria-label={`Gamma exposure profile ${label} for ${profile.symbol} ${profile.expiration}`}
        >
          <text x={MARGIN.left} y={12} fontSize={8.5} fill="var(--fyip-ink-faint)" fontFamily="monospace">
            PUT ←
          </text>
          <text x={width - MARGIN.right} y={12} textAnchor="end" fontSize={8.5} fill="var(--fyip-ink-faint)" fontFamily="monospace">
            → CALL
          </text>

          {strikes.map((strike, index) => {
            const y = yForStrike(strike);
            const row = rowByStrike.get(strike);
            const showLabel = index % labelEvery === 0 || index === strikes.length - 1;
            return (
              <g key={strike}>
                {showLabel && (
                  <text x={MARGIN.left - 6} y={y + 3} textAnchor="end" fontSize={8.5} fill="var(--fyip-ink-faint)" fontFamily="monospace">
                    {fmt(strike, strike >= 1000 ? 0 : 2)}
                  </text>
                )}
                {row && (
                  <>
                    <rect
                      x={zeroX}
                      y={y - 4.5}
                      width={Math.max(0, (row.callGex / maxAbs) * barMax)}
                      height={9}
                      fill="var(--fyip-up)"
                      opacity={0.82}
                    />
                    <rect
                      x={zeroX + (row.putGex / maxAbs) * barMax}
                      y={y - 4.5}
                      width={Math.max(0, Math.abs((row.putGex / maxAbs) * barMax))}
                      height={9}
                      fill="var(--fyip-down)"
                      opacity={0.82}
                    />
                  </>
                )}
                {hoveredStrike === strike && (
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y} y2={y} stroke="var(--fyip-amber)" strokeWidth={0.6} strokeDasharray="2 2" opacity={0.7} />
                )}
              </g>
            );
          })}

          <line x1={zeroX} x2={zeroX} y1={MARGIN.top} y2={MARGIN.top + plotH} stroke="var(--fyip-line-2)" strokeWidth={1} />

          {profile.spot >= minStrike && profile.spot <= maxStrike && (
            <>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={yForStrike(profile.spot)}
                y2={yForStrike(profile.spot)}
                stroke="var(--fyip-amber)"
                strokeWidth={1}
                strokeDasharray="5 3"
                opacity={0.9}
              />
              <text x={MARGIN.left + 4} y={yForStrike(profile.spot) - 3} fontSize={8.5} fill="var(--fyip-amber)" fontFamily="monospace">
                SPOT {fmt(profile.spot, 2)}
              </text>
            </>
          )}

          {cumulativePoints && (
            <polyline points={cumulativePoints} fill="none" stroke="var(--fyip-amber)" strokeWidth={1.3} opacity={0.9} />
          )}

          {hoveredY !== null && (
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={hoveredY} y2={hoveredY} stroke="var(--fyip-ink-dim)" strokeWidth={0.7} opacity={0.55} />
          )}
        </svg>
      </div>

      {hoveredStrike !== null && (
        <div className="pointer-events-none absolute right-8 top-8 z-10 min-w-44 border border-line-2 bg-panel-2/95 p-2 font-mono text-3xs text-ink-dim shadow-lg">
          <div className="mb-1 flex items-center justify-between gap-2 border-b border-line pb-1">
            <span className="text-amber">{label} · {fmt(hoveredStrike, hoveredStrike >= 1000 ? 0 : 2)}</span>
            <span className="text-ink-faint">{profile.expiration}</span>
          </div>
          <div className="flex justify-between gap-3"><span>CALL</span><span className="text-up">{hoveredRow ? fmtCompact(hoveredRow.callGex) : "—"}</span></div>
          <div className="flex justify-between gap-3"><span>PUT</span><span className="text-down">{hoveredRow ? fmtCompact(hoveredRow.putGex) : "—"}</span></div>
          <div className="flex justify-between gap-3"><span>NET</span><span className="text-ink">{hoveredRow ? fmtCompact(hoveredRow.netGex) : "—"}</span></div>
          <div className="flex justify-between gap-3"><span>CUM</span><span className="text-amber">{hoveredCum !== undefined ? fmtSigned(hoveredCum / 1e6, 2) + "M" : "—"}</span></div>
          <div className="mt-1 border-t border-line pt-1 text-ink-faint">{profile.unitLabel}</div>
          <div className="text-ink-faint">as of {profile.asOf.replace("T", " ").slice(0, 19)}Z</div>
        </div>
      )}
    </div>
  );
}
