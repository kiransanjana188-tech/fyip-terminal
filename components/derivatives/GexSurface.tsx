"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GexSurface as GexSurfaceData, GexSurfaceCell } from "@/lib/finance/gex-workspace";
import { clamp, cn, fmt, fmtCompact } from "@/lib/utils";

interface Props {
  surface: GexSurfaceData;
  className?: string;
}

interface Projected {
  x: number;
  y: number;
  depth: number;
}

interface Quad {
  key: string;
  cell: GexSurfaceCell;
  points: Projected[];
  depth: number;
}

const PALETTE = {
  teal: [45, 212, 191] as const,
  magenta: [224, 64, 160] as const,
  neutral: [14, 18, 23] as const,
  grid: "rgba(120, 132, 148, 0.28)",
  gridStrong: "rgba(154, 163, 175, 0.5)",
  floor: "rgba(7, 8, 10, 0.72)",
  ink: "#9aa3af",
  faint: "#5f6875",
  amber: "#e0a63c",
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

export function GexSurface({ surface, className }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quadsRef = useRef<Quad[]>([]);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const canvasSize = useRef({ width: 800, height: 460 });

  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(460);
  const [yaw, setYaw] = useState(-0.55);
  const [pitch, setPitch] = useState(0.4);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<"spot" | "view">("view");
  const [showSurface, setShowSurface] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [colorScale, setColorScale] = useState(true);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const cellByKey = useMemo(() => {
    const map = new Map<string, GexSurfaceCell>();
    for (const cell of surface.cells) map.set(`${cell.expiration}|${cell.strike}`, cell);
    return map;
  }, [surface.cells]);

  const hoverCell = hoverKey ? cellByKey.get(hoverKey) ?? null : null;
  const pinnedCell = pinnedKey ? cellByKey.get(pinnedKey) ?? null : null;
  const shownCell = hoverCell ?? pinnedCell;
  const shownPos = hoverCell ? hoverPos : null;

  const expirationDte = useMemo(
    () => new Map(surface.expirations.map((e) => [e.expiration, e.dteDays])),
    [surface.expirations],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setWidth(Math.max(260, Math.round(rect.width)));
      setHeight(Math.max(260, Math.round(rect.height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === wrapRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvasSize.current = { width: rect.width, height: rect.height };
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = rect.width;
    const H = rect.height;
    if (W < 20 || H < 20) return;
    ctx.clearRect(0, 0, W, H);

    const strikes = surface.strikes;
    if (strikes.length < 2 || surface.expirations.length === 0) {
      ctx.fillStyle = PALETTE.faint;
      ctx.font = "12px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("No surface grid is available for this selection.", W / 2, H / 2);
      return;
    }

    const minStrike = strikes[0];
    const maxStrike = strikes[strikes.length - 1];
    const xCenter = mode === "spot" ? clamp(surface.spot, minStrike, maxStrike) : (minStrike + maxStrike) / 2;
    const xSpan = Math.max(1e-9, (maxStrike - minStrike) * (mode === "spot" ? 0.55 : 1));
    const maxAbs = Math.max(1e-9, Math.abs(surface.minGex), Math.abs(surface.maxGex));
    const expCount = surface.expirations.length;
    const zFloor = -1.14;
    const scale = Math.min(W, H) * 0.28 * zoom;
    const xStretch = 1.9;

    const cx = W / 2;
    const cy = H * 0.43;

    function project(x: number, y: number, z: number): Projected {
      const xr = x * Math.cos(yaw) - y * Math.sin(yaw);
      const yr = x * Math.sin(yaw) + y * Math.cos(yaw);
      const yv = yr * Math.cos(pitch) - z * Math.sin(pitch);
      const depth = yr * Math.sin(pitch) + z * Math.cos(pitch);
      const persp = 1 / (1 + depth * 0.2);
      return { x: cx + xr * scale * xStretch * persp, y: cy + yv * scale * persp, depth };
    }

    function normX(strike: number): number {
      return (strike - xCenter) / (xSpan / 2);
    }
    function normY(index: number): number {
      if (expCount <= 1) return 0;
      return (index / (expCount - 1)) * 2 - 1;
    }
    function normZ(gex: number): number {
      return (gex / maxAbs) * 1.08;
    }

    function projectStrike(strike: number): number | null {
      const found = strikes.find((s) => Math.abs(s - strike) < 1e-9);
      return found === undefined ? null : normX(found);
    }

    function colorFor(gex: number): string {
      if (!colorScale) return "rgba(62, 143, 176, 0.42)";
      const nz = clamp(gex / maxAbs, -1, 1);
      return mix(PALETTE.neutral, nz >= 0 ? PALETTE.teal : PALETTE.magenta, Math.abs(nz) * 0.92);
    }

    // Floor
    const floorCorners = [
      project(-1, -1, zFloor),
      project(1, -1, zFloor),
      project(1, 1, zFloor),
      project(-1, 1, zFloor),
    ];
    ctx.beginPath();
    ctx.moveTo(floorCorners[0].x, floorCorners[0].y);
    for (let i = 1; i < floorCorners.length; i++) ctx.lineTo(floorCorners[i].x, floorCorners[i].y);
    ctx.closePath();
    ctx.fillStyle = PALETTE.floor;
    ctx.fill();

    // Floor grid
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 0.7;
    const xTickCount = Math.min(8, strikes.length);
    for (let t = 0; t < xTickCount; t++) {
      const strike = strikes[Math.round((t / Math.max(1, xTickCount - 1)) * (strikes.length - 1))];
      const x = normX(strike);
      if (Math.abs(x) > 1.35) continue;
      const a = project(x, -1, zFloor);
      const b = project(x, 1, zFloor);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let j = 0; j < Math.min(8, expCount); j++) {
      const index = Math.round((j / Math.max(1, Math.min(8, expCount) - 1)) * (expCount - 1));
      const y = normY(index);
      const a = project(-1, y, zFloor);
      const b = project(1, y, zFloor);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Surface quads
    const quads: Quad[] = [];
    for (let j = 0; j < expCount - 1; j++) {
      const expiryA = surface.expirations[j].expiration;
      const expiryB = surface.expirations[j + 1].expiration;
      const y0 = normY(j);
      const y1 = normY(j + 1);
      for (let i = 0; i < strikes.length - 1; i++) {
        const s0 = strikes[i];
        const s1 = strikes[i + 1];
        const c00 = cellByKey.get(`${expiryA}|${s0}`);
        const c10 = cellByKey.get(`${expiryA}|${s1}`);
        const c01 = cellByKey.get(`${expiryB}|${s0}`);
        const c11 = cellByKey.get(`${expiryB}|${s1}`);
        if (!c00 || !c10 || !c01 || !c11) continue;
        if (c00.gex === null || c10.gex === null || c01.gex === null || c11.gex === null) continue;
        const x0 = normX(s0);
        const x1 = normX(s1);
        if (Math.max(x0, x1) < -1.35 || Math.min(x0, x1) > 1.35) continue;
        const p00 = project(x0, y0, normZ(c00.gex));
        const p10 = project(x1, y0, normZ(c10.gex));
        const p01 = project(x0, y1, normZ(c01.gex));
        const p11 = project(x1, y1, normZ(c11.gex));
        const gex = (c00.gex + c10.gex + c01.gex + c11.gex) / 4;
        quads.push({
          key: `${expiryA}|${s0}`,
          cell: c00,
          points: [p00, p10, p11, p01],
          depth: (p00.depth + p10.depth + p01.depth + p11.depth) / 4,
        });
        if (!showSurface && !showGrid) continue;
        quads[quads.length - 1].cell = { expiration: expiryA, strike: s0, gex };
      }
    }
    quads.sort((a, b) => b.depth - a.depth);

    for (const quad of quads) {
      const p = quad.points;
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      if (showSurface) {
        ctx.fillStyle = colorFor(quad.cell.gex ?? 0);
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (showGrid) {
        ctx.strokeStyle = showSurface ? "rgba(12, 14, 18, 0.48)" : "rgba(154, 163, 175, 0.42)";
        ctx.lineWidth = 0.55;
        ctx.stroke();
      }
    }
    quadsRef.current = quads;

    // Highlighted cell
    const highlight = quads.find((q) => q.key === (hoverKey ?? pinnedKey));
    if (highlight) {
      const p = highlight.points;
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.strokeStyle = PALETTE.amber;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Spot marker
    const spotX = projectStrike(surface.spot);
    if (spotX !== null && spotX >= -1.35 && spotX <= 1.35) {
      const bottom = project(spotX, 0, zFloor);
      const top = project(spotX, 0, 1.18);
      ctx.beginPath();
      ctx.moveTo(bottom.x, bottom.y);
      ctx.lineTo(top.x, top.y);
      ctx.strokeStyle = PALETTE.amber;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      const mid = project(spotX, 0, 0);
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.amber;
      ctx.fill();
      ctx.fillStyle = PALETTE.amber;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`SPOT ${fmt(surface.spot, 2)}`, top.x, top.y - 7);
    }

    // Axes and labels
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = PALETTE.ink;
    ctx.strokeStyle = PALETTE.gridStrong;
    ctx.lineWidth = 0.8;

    const xTicks = Math.min(7, strikes.length);
    for (let t = 0; t < xTicks; t++) {
      const strike = strikes[Math.round((t / Math.max(1, xTicks - 1)) * (strikes.length - 1))];
      const x = normX(strike);
      if (Math.abs(x) > 1.35) continue;
      const a = project(x, 1, zFloor);
      const b = project(x, 1, zFloor - 0.16);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(fmt(strike, strike >= 1000 ? 0 : 2), a.x, Math.min(H - 4, a.y + 12));
    }
    ctx.fillStyle = PALETTE.faint;
    ctx.textAlign = "left";
    ctx.fillText("STRIKE", 8, H - 8);

    ctx.fillStyle = PALETTE.ink;
    const yTicks = Math.min(6, expCount);
    for (let t = 0; t < yTicks; t++) {
      const index = Math.round((t / Math.max(1, yTicks - 1)) * (expCount - 1));
      const y = normY(index);
      const a = project(-1.06, y, zFloor + 0.42);
      ctx.textAlign = "right";
      ctx.fillText(surface.expirations[index].expiration.slice(5), a.x - 6, a.y + 3);
    }
    ctx.fillStyle = PALETTE.faint;
    ctx.textAlign = "left";
    ctx.fillText("EXPIRY", 8, 14);

  }, [surface, width, height, yaw, pitch, zoom, mode, showSurface, showGrid, colorScale, hoverKey, pinnedKey, cellByKey]);

  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  wheelHandler.current = (event: WheelEvent) => {
    event.preventDefault();
    setZoom((z) => clamp(z * (event.deltaY > 0 ? 0.9 : 1.1), 0.55, 4));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (event: WheelEvent) => wheelHandler.current(event);
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, []);

  function hitTest(clientX: number, clientY: number): Quad | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    hoverRef.current = { x, y };
    const quads = quadsRef.current;
    for (let i = quads.length - 1; i >= 0; i--) {
      const quad = quads[i];
      if (pointInPolygon(x, y, quad.points)) return quad;
    }
    return null;
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, yaw, pitch, moved: false };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setYaw(drag.yaw + dx * 0.008);
      setPitch(clamp(drag.pitch + dy * 0.006, 0.12, 1.28));
      setHoverKey(null);
      setHoverPos(null);
      return;
    }
    const quad = hitTest(event.clientX, event.clientY);
    if (!quad) {
      setHoverKey(null);
      setHoverPos(null);
      return;
    }
    setHoverKey(quad.key);
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      setHoverPos({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    const quad = hitTest(event.clientX, event.clientY);
    setPinnedKey(quad ? quad.key : null);
    setHoverKey(quad ? quad.key : null);
  }

  function resetView() {
    setYaw(-0.55);
    setPitch(0.4);
    setZoom(1);
    setMode("view");
    setPinnedKey(null);
    setHoverKey(null);
  }

  async function toggleFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* fullscreen may be denied by the browser */
    }
  }

  const tooltipStyle = shownPos && hoverCell
    ? {
        left: `${clamp(shownPos.x + 14, 8, Math.max(8, width - 190))}px`,
        top: `${clamp(shownPos.y + 12, 8, Math.max(8, height - 130))}px`,
      }
    : undefined;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative flex flex-col overflow-hidden border border-line bg-base",
        isFullscreen ? "h-screen w-screen border-0" : "h-[36rem]",
        className,
      )}
    >
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-1.5">
        <div className="pointer-events-auto flex border border-line-2 bg-panel-2/90">
          {(["spot", "view"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setPinnedKey(null); }}
              className={cn(
                "px-2 py-1 font-mono text-3xs uppercase tracking-widest",
                mode === m ? "bg-amber/15 text-amber" : "text-ink-dim hover:text-ink",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <button onClick={resetView} className="pointer-events-auto border border-line-2 bg-panel-2/90 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber">
          Reset
        </button>
        <button onClick={toggleFullscreen} className="pointer-events-auto border border-line-2 bg-panel-2/90 px-2 py-1 font-mono text-3xs uppercase tracking-widest text-ink-dim hover:border-amber hover:text-amber">
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
      </div>

      <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        {([
          ["Surface", showSurface, setShowSurface],
          ["Grid", showGrid, setShowGrid],
          ["Color scale", colorScale, setColorScale],
        ] as const).map(([label, value, set]) => (
          <label key={label} className="pointer-events-auto flex items-center gap-1.5 border border-line-2 bg-panel-2/90 px-1.5 py-0.5 font-mono text-3xs text-ink-dim">
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => set(e.target.checked)}
              className="h-2.5 w-2.5 accent-amber"
            />
            {label}
          </label>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHoverKey(null);
            setHoverPos(null);
          }
        }}
        aria-label={`Interactive 3D gamma exposure surface for ${surface.symbol}`}
      />

      {hoverCell && hoverPos && (
        <div className="pointer-events-none absolute z-20 min-w-40 border border-line-2 bg-panel-2/95 p-2 font-mono text-3xs text-ink-dim shadow-lg" style={tooltipStyle}>
          <div className="mb-1 flex justify-between gap-3 border-b border-line pb-1">
            <span className="text-amber">{fmt(hoverCell.strike, hoverCell.strike >= 1000 ? 0 : 2)}</span>
            <span>{hoverCell.expiration}</span>
          </div>
          <div className="flex justify-between gap-3"><span>GEX</span><span className={cn(hoverCell.gex !== null && hoverCell.gex >= 0 ? "text-up" : "text-down")}>{hoverCell.gex === null ? "—" : fmtCompact(hoverCell.gex)}</span></div>
          <div className="flex justify-between gap-3"><span>DTE</span><span>{expirationDte.get(hoverCell.expiration) ?? "—"}d</span></div>
          <div className="mt-1 border-t border-line pt-1 text-ink-faint">{surface.unitLabel}</div>
        </div>
      )}

      {pinnedCell && !hoverCell && (
        <div className="pointer-events-none absolute bottom-2 right-2 z-10 border border-amber/40 bg-panel-2/95 px-2 py-1 font-mono text-3xs text-ink-dim">
          PINNED · {fmt(pinnedCell.strike, pinnedCell.strike >= 1000 ? 0 : 2)} · {pinnedCell.expiration} · {pinnedCell.gex === null ? "—" : fmtCompact(pinnedCell.gex)}
        </div>
      )}

      {colorScale && (
        <div className="pointer-events-none absolute left-2 top-12 z-10 border border-line-2 bg-panel-2/90 p-1.5">
          <div className="mb-1 flex justify-between gap-4 font-mono text-3xs text-ink-faint">
            <span>{fmtCompact(surface.minGex)}</span>
            <span>0</span>
            <span>{fmtCompact(surface.maxGex)}</span>
          </div>
          <div className="flex h-2 w-48 overflow-hidden">
            <div className="flex-1" style={{ background: `linear-gradient(to right, rgb(${PALETTE.magenta.join(",")}) 0%, rgb(${PALETTE.neutral.join(",")}) 50%, rgb(${PALETTE.teal.join(",")}) 100%)` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-3xs text-ink-faint">
            <span className="text-down">negative</span>
            <span className="text-up">positive</span>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 right-2 z-0 font-mono text-3xs text-ink-faint">
        drag rotate · wheel zoom · click pin
      </div>
    </div>
  );
}
