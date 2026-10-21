"use client";

import { useEffect, useRef, useState } from "react";
import type { FuturesSurface } from "@/lib/analytics/futures-profile";
import { clamp, cn, fmt, fmtCompact, fmtSigned } from "@/lib/utils";

interface Props {
  surface: FuturesSurface;
  digits?: number;
  className?: string;
}

interface Projected {
  x: number;
  y: number;
  depth: number;
}

interface Quad {
  key: string;
  points: Projected[];
  depth: number;
  volume: number;
  delta: number;
  bucket: string;
  price: number;
}

const PALETTE = {
  up: [34, 160, 107] as const,
  down: [229, 72, 77] as const,
  neutral: [62, 143, 176] as const,
  grid: "rgba(120, 132, 148, 0.25)",
  floor: "rgba(7, 8, 10, 0.72)",
  ink: "#9AA3AF",
  faint: "#5F6875",
  amber: "#E0A63C",
};

function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bch = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}

function pointInPolygon(x: number, y: number, points: Projected[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function VolumeSurface({ surface, digits = 0, className }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quadsRef = useRef<Quad[]>([]);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);

  const [size, setSize] = useState({ width: 900, height: 520 });
  const [yaw, setYaw] = useState(-0.6);
  const [pitch, setPitch] = useState(0.42);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [hoveredQuad, setHoveredQuad] = useState<Quad | null>(null);
  const [pinnedQuad, setPinnedQuad] = useState<Quad | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const hoverKey = hoveredQuad?.key ?? null;
  const pinnedKey = pinnedQuad?.key ?? null;
  const shownQuad = hoveredQuad ?? pinnedQuad;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(320, Math.round(rect.width)), height: Math.max(300, Math.round(rect.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = size.width;
    const H = size.height;
    if (W < 40 || H < 40) return;
    ctx.clearRect(0, 0, W, H);

    const buckets = surface.buckets;
    const prices = surface.prices;
    if (buckets.length < 2 || prices.length < 2) {
      ctx.fillStyle = PALETTE.faint;
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Not enough prints for a time × price surface in this window.", W / 2, H / 2);
      return;
    }

    const cellMap = new Map<string, { volume: number; delta: number }>();
    for (const cell of surface.cells) cellMap.set(`${cell.bucket}|${cell.price}`, { volume: cell.volume, delta: cell.delta });

    const floorZ = -0.16;
    const scale = Math.min(W, H) * 0.3 * zoom;
    const cx = W / 2;
    const cy = H * 0.42;

    function project(x: number, y: number, z: number): Projected {
      const xr = x * Math.cos(yaw) - y * Math.sin(yaw);
      const yr = x * Math.sin(yaw) + y * Math.cos(yaw);
      const yv = yr * Math.cos(pitch) - z * Math.sin(pitch);
      const depth = yr * Math.sin(pitch) + z * Math.cos(pitch);
      const persp = 1 / (1 + depth * 0.18);
      return { x: cx + xr * scale * persp, y: cy + yv * scale * persp, depth };
    }

    const bucketIndex = new Map<string, number>();
    buckets.forEach((bucket, index) => bucketIndex.set(bucket.key, index));
    const priceIndex = new Map<number, number>();
    prices.forEach((price, index) => priceIndex.set(price, index));

    function normX(bucket: string): number | null {
      const index = bucketIndex.get(bucket);
      if (index === undefined) return null;
      return buckets.length <= 1 ? 0 : (index / (buckets.length - 1)) * 2 - 1;
    }
    function normY(price: number): number | null {
      const index = priceIndex.get(price);
      if (index === undefined) return null;
      return prices.length <= 1 ? 0 : (index / (prices.length - 1)) * 2 - 1;
    }
    function normZ(volume: number): number {
      return surface.maxVolume > 0 ? clamp(volume / surface.maxVolume, 0, 1) * 1.05 : 0;
    }

    // Floor plane.
    const corners = [project(-1, -1, floorZ), project(1, -1, floorZ), project(1, 1, floorZ), project(-1, 1, floorZ)];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fillStyle = PALETTE.floor;
    ctx.fill();

    if (showGrid) {
      ctx.strokeStyle = PALETTE.grid;
      ctx.lineWidth = 0.7;
      const timeTicks = Math.min(8, buckets.length);
      for (let t = 0; t < timeTicks; t++) {
        const index = Math.round((t / Math.max(1, timeTicks - 1)) * (buckets.length - 1));
        const x = buckets.length <= 1 ? 0 : (index / (buckets.length - 1)) * 2 - 1;
        const a = project(x, -1, floorZ);
        const b = project(x, 1, floorZ);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      const priceTicks = Math.min(8, prices.length);
      for (let p = 0; p < priceTicks; p++) {
        const index = Math.round((p / Math.max(1, priceTicks - 1)) * (prices.length - 1));
        const y = prices.length <= 1 ? 0 : (index / (prices.length - 1)) * 2 - 1;
        const a = project(-1, y, floorZ);
        const b = project(1, y, floorZ);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Build quads over adjacent (time, price) cells.
    const quads: Quad[] = [];
    for (let b = 0; b < buckets.length - 1; b++) {
      for (let p = 0; p < prices.length - 1; p++) {
        const bA = buckets[b];
        const bB = buckets[b + 1];
        const pA = prices[p];
        const pB = prices[p + 1];
        const keys = [
          `${bA.key}|${pA}`,
          `${bB.key}|${pA}`,
          `${bB.key}|${pB}`,
          `${bA.key}|${pB}`,
        ];
        let volume = 0;
        let delta = 0;
        let count = 0;
        for (const key of keys) {
          const cell = cellMap.get(key);
          if (!cell) continue;
          volume += cell.volume;
          delta += cell.delta;
          count += 1;
        }
        if (count === 0) continue;
        const xA = normX(bA.key)!;
        const xB = normX(bB.key)!;
        const yA = normY(pA)!;
        const yB = normY(pB)!;
        const z = normZ(volume);
        const points = [
          project(xA, yA, z),
          project(xB, yA, z),
          project(xB, yB, z),
          project(xA, yB, z),
        ];
        const depth = (points[0].depth + points[2].depth) / 2;
        quads.push({ key: keys.join(";"), points, depth, volume, delta, bucket: bA.key, price: pA });
      }
    }

    quads.sort((a, b) => b.depth - a.depth);
    quadsRef.current = quads;

    for (const quad of quads) {
      const ratio = quad.volume > 0 ? clamp(quad.delta / quad.volume, -1, 1) : 0;
      ctx.beginPath();
      ctx.moveTo(quad.points[0].x, quad.points[0].y);
      for (let i = 1; i < quad.points.length; i++) ctx.lineTo(quad.points[i].x, quad.points[i].y);
      ctx.closePath();
      ctx.fillStyle = mix(PALETTE.neutral, ratio >= 0 ? PALETTE.up : PALETTE.down, Math.abs(ratio) * 0.9);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(7, 8, 10, 0.5)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      if (hoverKey === quad.key || pinnedKey === quad.key) {
        ctx.strokeStyle = PALETTE.amber;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    // Axis labels.
    ctx.fillStyle = PALETTE.faint;
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    const firstLabel = project(-1, -1, floorZ);
    const midLabel = project(0, -1, floorZ);
    const lastLabel = project(1, -1, floorZ);
    ctx.fillText(buckets[0].label, firstLabel.x, firstLabel.y + 14);
    ctx.textAlign = "center";
    ctx.fillText(buckets[Math.floor((buckets.length - 1) / 2)].label, midLabel.x, midLabel.y + 14);
    ctx.fillText(buckets[buckets.length - 1].label, lastLabel.x, lastLabel.y + 14);
    ctx.textAlign = "right";
    const lowLabel = project(-1, -1, floorZ);
    const highLabel = project(-1, 1, floorZ);
    ctx.fillText(fmt(prices[0], digits), lowLabel.x - 6, lowLabel.y + 3);
    ctx.fillText(fmt(prices[prices.length - 1], digits), highLabel.x - 6, highLabel.y + 3);
    ctx.textAlign = "left";
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText(`height = volume · ${surface.bucketMinutes}m buckets`, 8, H - 8);
  }, [surface, size, yaw, pitch, zoom, showGrid, hoverKey, pinnedKey, digits]);

  function hitTest(clientX: number, clientY: number): Quad | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const quads = quadsRef.current;
    for (let i = quads.length - 1; i >= 0; i--) {
      if (pointInPolygon(x, y, quads[i].points)) return quads[i];
    }
    return null;
  }

  return (
    <div
      ref={wrapRef}
      className={cn("relative h-full min-h-[360px] w-full overflow-hidden bg-base", className)}
      onWheel={(event) => {
        event.preventDefault();
        setZoom((value) => clamp(value * (event.deltaY > 0 ? 0.92 : 1.08), 0.45, 3));
      }}
      onPointerDown={(event) => {
        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
        dragRef.current = { x: event.clientX, y: event.clientY, yaw, pitch, moved: false };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag) {
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
          setYaw(clamp(drag.yaw + dx * 0.006, -2.4, 2.4));
          setPitch(clamp(drag.pitch + dy * 0.005, 0.08, 1.25));
          return;
        }
        const quad = hitTest(event.clientX, event.clientY);
        setHoveredQuad((prev) => (prev?.key === (quad?.key ?? null) ? prev : quad));
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || drag.moved) return;
        setPinnedQuad((prev) => (prev?.key === (hoveredQuad?.key ?? null) ? null : hoveredQuad));
      }}
      onPointerLeave={() => {
        dragRef.current = null;
        setHoveredQuad(null);
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" style={{ width: size.width, height: size.height }} />

      <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1 font-mono text-3xs uppercase tracking-wider text-ink-faint">
        <span>drag rotate · wheel zoom · click pin</span>
        {shownQuad && (
          <span className="border border-line-2 bg-panel-2/95 px-2 py-1 normal-case tracking-normal text-ink-dim">
            <span className="text-ink">{shownQuad.bucket.slice(-5)}</span> · price {fmt(shownQuad.price, digits)} ·{" "}
            {fmtCompact(shownQuad.volume)} contracts ·{" "}
            <span className={shownQuad.delta > 0 ? "text-up" : shownQuad.delta < 0 ? "text-down" : "text-ink-faint"}>
              delta {fmtSigned(shownQuad.delta, 0)}
            </span>
          </span>
        )}
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        <button
          onClick={() => {
            setYaw(-0.6);
            setPitch(0.42);
            setZoom(1);
            setPinnedQuad(null);
          }}
          className="pointer-events-auto border border-line bg-panel-2/90 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
        >
          Reset view
        </button>
        <button
          onClick={() => setShowGrid((value) => !value)}
          className={cn(
            "pointer-events-auto border px-2 py-1 font-mono text-3xs uppercase tracking-widest",
            showGrid ? "border-amber/50 bg-amber/10 text-amber" : "border-line bg-panel-2/90 text-ink-dim hover:border-line-2",
          )}
        >
          Grid
        </button>
        <button
          onClick={() => {
            if (document.fullscreenElement === wrapRef.current) void document.exitFullscreen();
            else void wrapRef.current?.requestFullscreen();
          }}
          className="pointer-events-auto border border-line bg-panel-2/90 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber"
        >
          {isFullscreen ? "Exit" : "Full"}
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2 border border-line bg-panel-2/90 px-2 py-1 font-mono text-3xs text-ink-faint">
        <span className="inline-block h-2 w-4 bg-[#22A06B]" /> buy-dominant
        <span className="inline-block h-2 w-4 bg-[#3E8FB0]" /> balanced
        <span className="inline-block h-2 w-4 bg-[#E5484D]" /> sell-dominant
      </div>
    </div>
  );
}
