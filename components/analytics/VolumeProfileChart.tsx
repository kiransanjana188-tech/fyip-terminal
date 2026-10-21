"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FuturesProfileBin } from "@/lib/analytics/futures-profile";
import { cn, fmt, fmtCompact, fmtSigned } from "@/lib/utils";

interface Props {
  bins: FuturesProfileBin[];
  spot: number | null;
  vwap: number | null;
  poc: number | null;
  vah: number | null;
  val: number | null;
  digits?: number;
  className?: string;
}

const PRICE_GUTTER = 58;
const RIGHT_PAD = 10;
const TOP_PAD = 8;
const BOTTOM_PAD = 14;

export function VolumeProfileChart({ bins, spot, vwap, poc, vah, val, digits = 2, className }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hovered, setHovered] = useState<{ price: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setWidth(Math.max(320, Math.round(rect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => [...bins].sort((a, b) => b.price - a.price), [bins]);
  const maxVolume = useMemo(() => rows.reduce((max, bin) => Math.max(max, bin.volume), 0), [rows]);
  const rowHeight = rows.length > 0 ? Math.max(4, Math.min(15, Math.floor(560 / rows.length))) : 10;
  const height = Math.max(120, rows.length * rowHeight + TOP_PAD + BOTTOM_PAD);
  const barArea = Math.max(40, width - PRICE_GUTTER - RIGHT_PAD);
  const hoveredBin = useMemo(() => {
    if (!hovered) return null;
    return rows.find((bin) => Math.abs(bin.price - hovered.price) < 1e-9) ?? null;
  }, [hovered, rows]);

  function rowTop(index: number): number {
    return TOP_PAD + index * rowHeight;
  }

  function yForPrice(price: number): number | null {
    const index = rows.findIndex((bin) => Math.abs(bin.price - price) < 1e-9);
    if (index < 0) return null;
    return rowTop(index) + rowHeight / 2;
  }

  function labelEvery(): number {
    return Math.max(1, Math.ceil(rows.length / 22));
  }

  const labelSkip = labelEvery();

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      {rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center font-mono text-2xs uppercase tracking-widest text-ink-faint">
          No trade prints in the selected window.
        </div>
      ) : (
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Volume at price profile"
          className="block select-none"
          onMouseLeave={() => setHovered(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const y = event.clientY - rect.top;
            const index = Math.floor((y - TOP_PAD) / rowHeight);
            const bin = rows[index];
            if (!bin) {
              setHovered(null);
              return;
            }
            setHovered({ price: bin.price, y: yForPrice(bin.price) ?? y });
          }}
        >
          {rows.map((bin, index) => {
            const top = rowTop(index);
            const inValueArea = val !== null && vah !== null && bin.price >= val && bin.price <= vah;
            return (
              <g key={bin.price}>
                {inValueArea && (
                  <rect
                    x={PRICE_GUTTER}
                    y={top}
                    width={barArea}
                    height={rowHeight}
                    fill="rgba(224, 166, 60, 0.05)"
                  />
                )}
                <rect
                  x={PRICE_GUTTER}
                  y={top + 1}
                  width={maxVolume > 0 ? Math.max(1, (bin.volume / maxVolume) * barArea) : 1}
                  height={Math.max(1, rowHeight - 2)}
                  fill={bin.delta > 0 ? "#22A06B" : bin.delta < 0 ? "#E5484D" : "#5F6875"}
                  fillOpacity={hoveredBin && hoveredBin.price === bin.price ? 0.95 : 0.62}
                />
                {index % labelSkip === 0 && (
                  <text
                    x={PRICE_GUTTER - 6}
                    y={top + rowHeight / 2 + 3}
                    textAnchor="end"
                    className="fill-ink-faint font-mono text-3xs tabular"
                    fontSize={9}
                  >
                    {fmt(bin.price, digits)}
                  </text>
                )}
              </g>
            );
          })}

          {val !== null && yForPrice(val) !== null && (
            <line
              x1={PRICE_GUTTER}
              x2={width - RIGHT_PAD}
              y1={yForPrice(val)!}
              y2={yForPrice(val)!}
              stroke="rgba(154, 163, 175, 0.55)"
              strokeDasharray="3 3"
            />
          )}
          {vah !== null && yForPrice(vah) !== null && (
            <line
              x1={PRICE_GUTTER}
              x2={width - RIGHT_PAD}
              y1={yForPrice(vah)!}
              y2={yForPrice(vah)!}
              stroke="rgba(154, 163, 175, 0.55)"
              strokeDasharray="3 3"
            />
          )}
          {poc !== null && yForPrice(poc) !== null && (
            <line
              x1={PRICE_GUTTER}
              x2={width - RIGHT_PAD}
              y1={yForPrice(poc)!}
              y2={yForPrice(poc)!}
              stroke="#E0A63C"
              strokeWidth={1}
            />
          )}
          {vwap !== null && yForPrice(vwap) !== null && (
            <line
              x1={PRICE_GUTTER}
              x2={width - RIGHT_PAD}
              y1={yForPrice(vwap)!}
              y2={yForPrice(vwap)!}
              stroke="#3E8FB0"
              strokeDasharray="5 4"
            />
          )}
          {spot !== null && yForPrice(spot) !== null && (
            <line
              x1={PRICE_GUTTER}
              x2={width - RIGHT_PAD}
              y1={yForPrice(spot)!}
              y2={yForPrice(spot)!}
              stroke="#E7EAEE"
              strokeDasharray="2 3"
              strokeOpacity={0.85}
            />
          )}

          <text x={2} y={height - 3} className="fill-ink-faint font-mono text-3xs" fontSize={9}>
            {rows.length} rows · {fmtCompact(maxVolume)} max
          </text>
        </svg>
      )}

      {hoveredBin && (
        <div
          className="pointer-events-none absolute right-2 z-10 border border-line-2 bg-panel-2/95 px-2 py-1.5 font-mono text-3xs text-ink-dim shadow-lg"
          style={{ top: Math.min(Math.max(0, hovered!.y - 10), height - 70) }}
        >
          <div className="text-ink">Price {fmt(hoveredBin.price, digits)}</div>
          <div>Volume {fmtCompact(hoveredBin.volume)}</div>
          <div className={hoveredBin.delta > 0 ? "text-up" : hoveredBin.delta < 0 ? "text-down" : "text-ink-faint"}>
            Delta {fmtSigned(hoveredBin.delta, 0)}
          </div>
        </div>
      )}
    </div>
  );
}
