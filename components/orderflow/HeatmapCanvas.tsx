"use client";

import { useEffect, useRef } from "react";
import {
  heatGaps,
  heatIntensity,
  heatPriceRange,
  priceTicks,
  snapshotTime,
  type HeatScale,
  type HeatSnapshot,
  type HeatTrade,
} from "@/lib/orderflow/heatmap";

export interface HeatmapCanvasProps {
  symbol: string;
  tickSize: number;
  priceScale: number;
  snapshots: HeatSnapshot[];
  trades: HeatTrade[];
  windowMs: number | null;
  follow: boolean;
  scale: HeatScale;
  minTradeSize: number;
  showTrades: boolean;
  showGaps: boolean;
  levels: number;
  resetToken: number;
}

interface Dims {
  width: number;
  height: number;
}

const BG = "#080A0D";
const PANEL = "#0C0E12";
const GRID = "rgba(148, 163, 184, 0.10)";
const AXIS_TEXT = "#64748B";
const BID_RGB = "45, 212, 191";
const ASK_RGB = "244, 63, 94";

function decimalPlaces(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString();
  if (text.includes("e-")) return Math.min(8, Number(text.split("e-")[1]));
  return Math.min(8, text.split(".")[1]?.length ?? 2);
}

function niceTimeStep(spanMs: number): number {
  const steps = [1000, 5000, 15000, 30000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000, 86_400_000];
  const target = spanMs / 7;
  return steps.find((step) => step >= target) ?? steps[steps.length - 1];
}

function timeLabel(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs >= 86_400_000) {
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function tradeKey(trade: HeatTrade): string {
  return `${trade.eventTimestamp}|${trade.price}|${trade.size}|${trade.side ?? "null"}`;
}

function rateColor(side: HeatTrade["side"]): string {
  if (side === "buy") return "#22C55E";
  if (side === "sell") return "#F43F5E";
  if (side === "cross") return "#A78BFA";
  return "#94A3B8";
}

export function HeatmapCanvas(props: HeatmapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimsRef = useRef<Dims>({ width: 0, height: 0 });
  const dataRef = useRef(props);
  const viewRef = useRef<{ end: number | null; zoom: number }>({ end: null, zoom: 1 });
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; end: number } | null>(null);
  const followRef = useRef(props.follow);
  const frameRef = useRef<number | null>(null);
  const resetRef = useRef(props.resetToken);

  dataRef.current = props;

  function schedule(): void {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      draw();
    });
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      dimsRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      schedule();
    });
    observer.observe(wrap);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resetRef.current !== props.resetToken) {
      resetRef.current = props.resetToken;
      viewRef.current = { end: null, zoom: 1 };
    }
    if (followRef.current !== props.follow) {
      followRef.current = props.follow;
      const bounds = timeBounds();
      if (props.follow) {
        viewRef.current.end = null;
        viewRef.current.zoom = 1;
      } else if (bounds) {
        viewRef.current.end = bounds.to;
      }
    }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.snapshots,
    props.trades,
    props.windowMs,
    props.follow,
    props.scale,
    props.minTradeSize,
    props.showTrades,
    props.showGaps,
    props.levels,
    props.resetToken,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = timeBounds();
      if (!bounds) return;
      const zoom = viewRef.current.zoom;
      const nextZoom = Math.min(32, Math.max(0.05, zoom * (event.deltaY > 0 ? 1.18 : 0.85)));
      viewRef.current.zoom = nextZoom;
      const end = viewRef.current.end ?? bounds.to;
      viewRef.current.end = end;
      schedule();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onPointerDown = (event: PointerEvent) => {
      const end = currentEnd();
      if (end === null) return;
      dragRef.current = { x: event.clientX, end };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      pointerRef.current = { x: event.clientX - canvasRect.left, y: event.clientY - canvasRect.top };
      const drag = dragRef.current;
      if (drag) {
        const plot = plotRect();
        const bounds = timeBounds();
        if (bounds && plot.width > 0) {
          const span = currentSpan();
          const msPerPx = span / plot.width;
          viewRef.current.end = drag.end - (event.clientX - drag.x) * msPerPx;
          viewRef.current.end = Math.min(bounds.to + span * 0.5, Math.max(bounds.from - span * 0.5, viewRef.current.end));
        }
      }
      schedule();
    };
    const onPointerUp = (event: PointerEvent) => {
      dragRef.current = null;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* no capture */
      }
    };
    const onPointerLeave = () => {
      pointerRef.current = null;
      schedule();
    };
    const onDoubleClick = () => {
      viewRef.current = { end: null, zoom: 1 };
      schedule();
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("dblclick", onDoubleClick);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function timeBounds(): { from: number; to: number } | null {
    const data = dataRef.current;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const snapshot of data.snapshots) {
      const t = snapshotTime(snapshot);
      if (!Number.isFinite(t)) continue;
      from = Math.min(from, t);
      to = Math.max(to, t);
    }
    for (const trade of data.trades) {
      const t = new Date(trade.eventTimestamp).getTime();
      if (!Number.isFinite(t)) continue;
      from = Math.min(from, t);
      to = Math.max(to, t);
    }
    return from <= to ? { from, to } : null;
  }

  function baseWindow(): number {
    const data = dataRef.current;
    if (data.windowMs && Number.isFinite(data.windowMs)) return data.windowMs;
    const bounds = timeBounds();
    if (!bounds) return 300_000;
    return Math.max(30_000, bounds.to - bounds.from);
  }

  function currentSpan(): number {
    return baseWindow() * viewRef.current.zoom;
  }

  function currentEnd(): number | null {
    const bounds = timeBounds();
    if (!bounds) return null;
    const override = viewRef.current.end;
    return override ?? bounds.to;
  }

  function plotRect() {
    const { width, height } = dimsRef.current;
    return { left: 12, right: width - 62, top: 24, bottom: height - 22, width: Math.max(1, width - 74), height: Math.max(1, height - 46) };
  }

  function draw(): void {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const data = dataRef.current;
    const { width, height } = dimsRef.current;
    if (width <= 0 || height <= 0) return;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);

    const bounds = timeBounds();
    const plot = plotRect();
    if (!bounds) {
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for depth snapshots — the heatmap needs collected bridge data.", width / 2, height / 2);
      return;
    }

    const span = currentSpan();
    const end = currentEnd() ?? bounds.to;
    const start = end - span;

    const visibleSnapshots = data.snapshots.filter((snapshot) => {
      const t = snapshotTime(snapshot);
      return t >= start && t <= end;
    });
    const visibleTrades = data.showTrades
      ? data.trades.filter((trade) => {
          const t = new Date(trade.eventTimestamp).getTime();
          return t >= start && t <= end && trade.size >= data.minTradeSize;
        })
      : [];

    const priceRange = heatPriceRange(visibleSnapshots, visibleTrades) ?? heatPriceRange(data.snapshots, data.trades);
    const minPrice = priceRange?.min ?? 0;
    const maxPrice = priceRange?.max ?? 1;
    const padding = Math.max((maxPrice - minPrice) * 0.06, (data.tickSize || 0.01) * 2);
    const low = minPrice - padding;
    const high = maxPrice + padding;
    const priceToY = (price: number) => plot.top + ((high - price) / Math.max(1e-9, high - low)) * plot.height;
    const timeToX = (t: number) => plot.left + ((t - start) / Math.max(1, span)) * plot.width;

    let maxVolume = 1;
    for (const snapshot of visibleSnapshots) {
      for (const level of snapshot.bids) maxVolume = Math.max(maxVolume, level.volume);
      for (const level of snapshot.asks) maxVolume = Math.max(maxVolume, level.volume);
    }

    if (data.showGaps) {
      const gaps = heatGaps(visibleSnapshots);
      for (const gap of gaps) {
        const x1 = timeToX(gap.from);
        const x2 = timeToX(gap.to);
        if (x2 - x1 < 2) continue;
        ctx.fillStyle = "rgba(148, 163, 184, 0.045)";
        ctx.fillRect(x1, plot.top, x2 - x1, plot.height);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.10)";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(x1, plot.top);
        ctx.lineTo(x1, plot.bottom);
        ctx.moveTo(x2, plot.top);
        ctx.lineTo(x2, plot.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        if (x2 - x1 > 54) {
          ctx.save();
          ctx.translate((x1 + x2) / 2, plot.top + 14);
          ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
          ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`NO DATA ${formatGap(gap.ms)}`, 0, 0);
          ctx.restore();
        }
      }
    }

    const levelHeight = Math.max(1, Math.abs(priceToY(0) - priceToY(data.tickSize || 0.01)) + 0.5);
    let lastSnapshotTime = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < visibleSnapshots.length; i++) {
      const snapshot = visibleSnapshots[i];
      const t = snapshotTime(snapshot);
      const x1 = timeToX(t);
      const nextT = i + 1 < visibleSnapshots.length ? snapshotTime(visibleSnapshots[i + 1]) : t + Math.max(250, span / Math.max(1, plot.width));
      const cellWidth = Math.max(1, timeToX(nextT) - x1);
      if (x1 + cellWidth < plot.left || x1 > plot.right) continue;
      lastSnapshotTime = Math.max(lastSnapshotTime, t);

      const bids = snapshot.bids.slice(0, data.levels);
      for (const level of bids) {
        const intensity = heatIntensity(level.volume, maxVolume, data.scale);
        const y = priceToY(level.price);
        if (y + levelHeight < plot.top || y - levelHeight > plot.bottom) continue;
        ctx.fillStyle = `rgba(${BID_RGB}, ${0.05 + intensity * 0.62})`;
        ctx.fillRect(x1, y - levelHeight / 2, Math.max(1, cellWidth + 0.6), levelHeight);
      }
      const asks = snapshot.asks.slice(0, data.levels);
      for (const level of asks) {
        const intensity = heatIntensity(level.volume, maxVolume, data.scale);
        const y = priceToY(level.price);
        if (y + levelHeight < plot.top || y - levelHeight > plot.bottom) continue;
        ctx.fillStyle = `rgba(${ASK_RGB}, ${0.05 + intensity * 0.55})`;
        ctx.fillRect(x1, y - levelHeight / 2, Math.max(1, cellWidth + 0.6), levelHeight);
      }
    }

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = AXIS_TEXT;

    const priceStep = priceTicks(low, high, data.tickSize || 0.01, Math.max(4, Math.floor(plot.height / 42)));
    const decimals = decimalPlaces(data.tickSize);
    ctx.textAlign = "left";
    for (const price of priceStep) {
      const y = priceToY(price);
      if (y < plot.top || y > plot.bottom) continue;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      ctx.fillText(price.toFixed(decimals), plot.right + 6, y + 3);
    }

    const step = niceTimeStep(span);
    const firstTick = Math.ceil(start / step) * step;
    ctx.textAlign = "center";
    for (let t = firstTick; t <= end; t += step) {
      const x = timeToX(t);
      if (x < plot.left || x > plot.right) continue;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();
      ctx.fillText(timeLabel(t, span), x, 14);
    }

    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.strokeRect(plot.left, plot.top, plot.width, plot.height);

    const maxTrade = visibleTrades.reduce((max, trade) => Math.max(max, trade.size), 1);
    for (const trade of visibleTrades) {
      const t = new Date(trade.eventTimestamp).getTime();
      const x = timeToX(t);
      const y = priceToY(trade.price);
      if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom) continue;
      const radius = 1.8 + Math.sqrt(trade.size / maxTrade) * 7;
      ctx.beginPath();
      ctx.arc(x, y, Math.min(11, radius), 0, Math.PI * 2);
      ctx.fillStyle = rateColor(trade.side);
      ctx.globalAlpha = trade.sideSource === "inferred" ? 0.68 : 0.88;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const lastTrade = [...visibleTrades].sort(
      (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
    )[visibleTrades.length - 1];
    if (lastTrade) {
      const y = priceToY(lastTrade.price);
      ctx.strokeStyle = "rgba(224, 166, 60, 0.7)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#E0A63C";
      ctx.textAlign = "left";
      ctx.fillText(lastTrade.price.toFixed(decimals), plot.right + 6, y - 4);
    }

    if (data.snapshots.length === 0 && visibleTrades.length > 0) {
      ctx.fillStyle = "rgba(224, 166, 60, 0.9)";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO VALID DEPTH — SHOWING TRADE PRINTS ONLY", plot.left + plot.width / 2, plot.top + 18);
    }

    drawLegend(ctx, plot, data, maxVolume, lastSnapshotTime);

    const pointer = pointerRef.current;
    if (pointer && pointer.x >= plot.left && pointer.x <= plot.right && pointer.y >= plot.top && pointer.y <= plot.bottom) {
      drawCrosshair(ctx, plot, pointer, start, span, low, high, data, visibleSnapshots, visibleTrades, decimals);
    }
  }

  function drawLegend(
    ctx: CanvasRenderingContext2D,
    plot: { left: number; right: number; top: number; bottom: number; width: number; height: number },
    data: HeatmapCanvasProps,
    maxVolume: number,
    lastSnapshotTime: number,
  ): void {
    ctx.textAlign = "left";
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(148, 163, 184, 0.85)";
    const legendY = plot.top + 10;
    ctx.fillStyle = `rgba(${BID_RGB}, 0.9)`;
    ctx.fillRect(plot.left + 2, legendY - 6, 7, 7);
    ctx.fillStyle = AXIS_TEXT;
    ctx.fillText("bid liquidity", plot.left + 13, legendY);
    ctx.fillStyle = `rgba(${ASK_RGB}, 0.9)`;
    ctx.fillRect(plot.left + 92, legendY - 6, 7, 7);
    ctx.fillStyle = AXIS_TEXT;
    ctx.fillText("ask liquidity", plot.left + 103, legendY);
    if (data.snapshots.length > 0) {
      const first = snapshotTime(data.snapshots[0]);
      const last = snapshotTime(data.snapshots[data.snapshots.length - 1]);
      ctx.textAlign = "right";
      ctx.fillText(
        `${data.symbol} · ${data.snapshots.length} snapshots · ${data.trades.length} prints · max ${Math.round(maxVolume).toLocaleString("en-US")} @ level`,
        plot.right,
        14,
      );
      ctx.fillText(
        `collected ${new Date(first).toLocaleString("en-US", { hour12: false })} → ${new Date(last).toLocaleTimeString("en-US", { hour12: false })}`,
        plot.right,
        plot.top + 10,
      );
    }
    if (Number.isFinite(lastSnapshotTime)) {
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
      ctx.fillText("wheel: zoom · drag: pan · double-click: reset", plot.left, plot.bottom + 15);
    }
  }

  function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    plot: { left: number; right: number; top: number; bottom: number; width: number; height: number },
    pointer: { x: number; y: number },
    start: number,
    span: number,
    low: number,
    high: number,
    data: HeatmapCanvasProps,
    snapshots: HeatSnapshot[],
    trades: HeatTrade[],
    decimals: number,
  ): void {
    const t = start + ((pointer.x - plot.left) / plot.width) * span;
    const price = high - ((pointer.y - plot.top) / plot.height) * (high - low);

    ctx.strokeStyle = "rgba(226, 232, 240, 0.25)";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(pointer.x, plot.top);
    ctx.lineTo(pointer.x, plot.bottom);
    ctx.moveTo(plot.left, pointer.y);
    ctx.lineTo(plot.right, pointer.y);
    ctx.stroke();
    ctx.setLineDash([]);

    let nearest: HeatSnapshot | null = null;
    let nearestTime = Number.NEGATIVE_INFINITY;
    for (const snapshot of snapshots) {
      const st = snapshotTime(snapshot);
      if (st <= t && st > nearestTime) {
        nearestTime = st;
        nearest = snapshot;
      }
    }
    if (!nearest) return;

    const bid = [...nearest.bids].sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
    const ask = [...nearest.asks].sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))[0];
    const nearby = trades
      .filter((trade) => Math.abs(new Date(trade.eventTimestamp).getTime() - t) < 3000)
      .sort((a, b) => b.size - a.size)[0];

    const lines = [
      new Date(nearestTime).toLocaleTimeString("en-US", { hour12: false }),
      `px ${price.toFixed(decimals)}`,
      `bid ${bid ? `${bid.volume.toLocaleString("en-US")} @ ${bid.price.toFixed(decimals)}` : "—"}`,
      `ask ${ask ? `${ask.volume.toLocaleString("en-US")} @ ${ask.price.toFixed(decimals)}` : "—"}`,
      nearby ? `print ${nearby.size.toLocaleString("en-US")} @ ${nearby.price.toFixed(decimals)} (${nearby.side ?? "n/a"}${nearby.sideSource === "inferred" ? ", inferred" : ""})` : "print — near cursor",
    ];

    const boxWidth = 214;
    const boxHeight = 13 * lines.length + 8;
    const boxX = Math.min(plot.right - boxWidth - 4, pointer.x + 12);
    const boxY = Math.min(plot.bottom - boxHeight - 4, pointer.y + 12);
    ctx.fillStyle = "rgba(4, 8, 12, 0.9)";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    lines.forEach((line, index) => {
      ctx.fillStyle = index === 0 ? "#E2E8F0" : index === 2 ? "#2DD4BF" : index === 3 ? "#FB7185" : "#94A3B8";
      ctx.fillText(line, boxX + 8, boxY + 15 + index * 13);
    });
  }

  function formatGap(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 120) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 120) return `${minutes}m`;
    return `${Math.round(minutes / 60)}h`;
  }

  return (
    <div ref={wrapRef} className="relative h-full min-h-[280px] w-full">
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" aria-label={`Liquidity heatmap for ${props.symbol}`} />
    </div>
  );
}
