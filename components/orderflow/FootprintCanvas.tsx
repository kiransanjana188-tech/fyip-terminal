"use client";

import { useEffect, useRef } from "react";
import type { FootprintBar, FootprintLevel, FootprintSession } from "@/lib/orderflow/footprint";
import { fmtCompact } from "@/lib/utils";

export interface FootprintCanvasProps {
  symbol: string;
  tickSize: number;
  priceScale: number;
  bars: FootprintBar[];
  session: FootprintSession;
  rowStep: number;
  barWidth: number;
  follow: boolean;
  showImbalance: boolean;
  showPoc: boolean;
  showValueArea: boolean;
  showUnknown: boolean;
  showDelta: boolean;
  resetToken: number;
}

interface Dims {
  width: number;
  height: number;
}

const BG = "#080A0D";
const HEADER = "#0C0E12";
const GRID = "rgba(148, 163, 184, 0.08)";
const TEXT = "#94A3B8";
const TEXT_DIM = "#64748B";
const UP = "#22C55E";
const DOWN = "#F43F5E";
const POC = "#E0A63C";
const HEADER_HEIGHT = 30;
const FOOTER_HEIGHT = 16;
const AXIS_WIDTH = 58;
const LEFT_PAD = 4;

function decimalPlaces(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString();
  if (text.includes("e-")) return Math.min(8, Number(text.split("e-")[1]));
  return Math.min(8, text.split(".")[1]?.length ?? 2);
}

function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

function volumeLabel(volume: number): string {
  if (volume <= 0) return "0";
  return volume >= 1000 ? fmtCompact(volume) : String(Math.round(volume));
}

export function FootprintCanvas(props: FootprintCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimsRef = useRef<Dims>({ width: 0, height: 0 });
  const dataRef = useRef(props);
  const scrollRef = useRef(0);
  const endRef = useRef<number | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; scroll: number; end: number } | null>(null);
  const frameRef = useRef<number | null>(null);
  const resetRef = useRef(props.resetToken);
  const followRef = useRef(props.follow);

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
      scrollRef.current = 0;
      endRef.current = null;
    }
    if (followRef.current !== props.follow) {
      followRef.current = props.follow;
      endRef.current = props.follow ? null : currentEnd();
    }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.bars,
    props.barWidth,
    props.follow,
    props.showImbalance,
    props.showPoc,
    props.showValueArea,
    props.showUnknown,
    props.showDelta,
    props.resetToken,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.shiftKey) {
        const delta = event.deltaY > 0 ? 1 : -1;
        const count = visibleCount();
        const end = currentEnd();
        endRef.current = Math.min(props.bars.length, Math.max(count, end + delta));
      } else {
        const max = maxScroll();
        scrollRef.current = Math.min(max, Math.max(0, scrollRef.current + event.deltaY));
      }
      schedule();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bars.length, props.barWidth]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onPointerDown = (event: PointerEvent) => {
      dragRef.current = { x: event.clientX, y: event.clientY, scroll: scrollRef.current, end: currentEnd() };
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const drag = dragRef.current;
      if (drag) {
        const dy = event.clientY - drag.y;
        const dx = event.clientX - drag.x;
        scrollRef.current = Math.min(maxScroll(), Math.max(0, drag.scroll - dy));
        const count = visibleCount();
        const shift = Math.round(dx / Math.max(20, dataRef.current.barWidth));
        if (shift !== 0) {
          endRef.current = Math.min(
            dataRef.current.bars.length,
            Math.max(count, drag.end - shift),
          );
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
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function plotRect() {
    const { width, height } = dimsRef.current;
    return {
      left: LEFT_PAD,
      right: Math.max(LEFT_PAD + 1, width - AXIS_WIDTH),
      top: HEADER_HEIGHT,
      bottom: Math.max(HEADER_HEIGHT + 1, height - FOOTER_HEIGHT),
      width: Math.max(1, width - AXIS_WIDTH - LEFT_PAD),
      height: Math.max(1, height - HEADER_HEIGHT - FOOTER_HEIGHT),
    };
  }

  function visibleCount(): number {
    const plot = plotRect();
    return Math.max(1, Math.floor(plot.width / Math.max(28, dataRef.current.barWidth)));
  }

  function currentEnd(): number {
    const count = visibleCount();
    const total = dataRef.current.bars.length;
    const override = endRef.current;
    if (!dataRef.current.follow && override === null) return Math.min(total, count);
    return Math.min(total, Math.max(count, override ?? total));
  }

  function allPrices(): number[] {
    const prices = new Set<number>();
    for (const bar of dataRef.current.bars) {
      for (const level of bar.levels) prices.add(level.price);
    }
    return [...prices].sort((a, b) => b - a);
  }

  function maxScroll(): number {
    return Math.max(0, allPrices().length * 14 - plotRect().height);
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

    const plot = plotRect();
    const count = visibleCount();
    const end = currentEnd();
    const start = Math.max(0, end - count);
    const visible = data.bars.slice(start, end);
    const rowHeight = 14;
    const prices = allPrices();
    const maxScrollValue = Math.max(0, prices.length * rowHeight - plot.height);
    scrollRef.current = Math.min(maxScrollValue, Math.max(0, scrollRef.current));

    ctx.fillStyle = HEADER;
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);
    ctx.fillRect(plot.right, 0, AXIS_WIDTH, height);

    if (data.bars.length === 0) {
      ctx.fillStyle = TEXT;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("No trade prints collected for this contract yet.", width / 2, height / 2);
      ctx.fillStyle = TEXT_DIM;
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText("FOOT builds only from real bridge prints — start the Add-On or reference bridge.", width / 2, height / 2 + 18);
      return;
    }

    if (visible.length === 0) {
      ctx.fillStyle = TEXT;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText("No bars in the selected window.", width / 2, height / 2);
      return;
    }

    const barWidth = plot.width / Math.max(1, count);
    ctx.fillStyle = TEXT_DIM;
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${data.symbol} · ${visible.length}/${data.bars.length} bars · ${data.showUnknown ? "unknown volume shown" : "unknown hidden"}`, plot.left + 2, 12);
    ctx.textAlign = "right";
    ctx.fillText(
      `POC ${data.session.pocPrice?.toFixed(decimalPlaces(data.tickSize)) ?? "—"} · Δ ${data.session.delta >= 0 ? "+" : ""}${volumeLabel(Math.abs(data.session.delta))} · ${data.session.sideCoverage.inferredPct.toFixed(0)}% inferred · collected ${new Date(data.bars[0].startTime).toLocaleTimeString("en-US", { hour12: false })}→${new Date(data.bars[data.bars.length - 1].endTime).toLocaleTimeString("en-US", { hour12: false })}`,
      plot.right - 4,
      12,
    );

    const priceToIndex = new Map<number, number>();
    prices.forEach((price, index) => priceToIndex.set(price, index));

    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    for (let i = 0; i < prices.length; i++) {
      const y = plot.top + i * rowHeight - scrollRef.current;
      if (y + rowHeight < plot.top || y > plot.bottom) continue;
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(148, 163, 184, 0.025)";
        ctx.fillRect(plot.left, y, plot.width, rowHeight);
      }
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(plot.left, y + rowHeight);
      ctx.lineTo(plot.right, y + rowHeight);
      ctx.stroke();
      ctx.fillStyle = TEXT;
      ctx.textAlign = "right";
      ctx.fillText(prices[i].toFixed(decimalPlaces(data.tickSize)), plot.right + AXIS_WIDTH - 6, y + rowHeight - 4);
    }

    ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
    ctx.beginPath();
    ctx.moveTo(plot.right, plot.top);
    ctx.lineTo(plot.right, plot.bottom);
    ctx.moveTo(plot.left, plot.top);
    ctx.lineTo(plot.right, plot.top);
    ctx.stroke();

    if (data.showPoc && data.session.pocPrice !== null) {
      drawPriceLine(ctx, plot, priceToIndex.get(data.session.pocPrice), rowHeight, POC, `POC ${data.session.pocPrice.toFixed(decimalPlaces(data.tickSize))}`, scrollRef.current, prices.length * rowHeight);
    }
    if (data.showValueArea && data.session.valueAreaHigh !== null && data.session.valueAreaLow !== null) {
      const high = nearestPrice(prices, data.session.valueAreaHigh);
      const low = nearestPrice(prices, data.session.valueAreaLow);
      drawPriceLine(ctx, plot, priceToIndex.get(high), rowHeight, "rgba(148, 163, 184, 0.5)", `VAH ${high.toFixed(decimalPlaces(data.tickSize))}`, scrollRef.current, prices.length * rowHeight);
      drawPriceLine(ctx, plot, priceToIndex.get(low), rowHeight, "rgba(148, 163, 184, 0.5)", `VAL ${low.toFixed(decimalPlaces(data.tickSize))}`, scrollRef.current, prices.length * rowHeight);
    }

    const maxBarVolume = Math.max(1, ...visible.map((bar) => bar.totalVolume));

    for (let column = 0; column < visible.length; column++) {
      const bar = visible[column];
      const x = plot.left + column * barWidth;
      const centerX = x + barWidth / 2;

      ctx.fillStyle = column % 2 === 0 ? "rgba(12, 14, 18, 0.75)" : "rgba(9, 11, 15, 0.75)";
      ctx.fillRect(x, plot.top, barWidth, plot.height);

      ctx.fillStyle = TEXT_DIM;
      ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillText(shortTime(bar.startTime), centerX, 12);
      if (data.showDelta) {
        const deltaColor = bar.delta > 0 ? UP : bar.delta < 0 ? DOWN : TEXT_DIM;
        ctx.fillStyle = deltaColor;
        ctx.fillText(`${bar.delta >= 0 ? "+" : ""}${volumeLabel(Math.abs(bar.delta))}`, centerX, 23);
      }
      if (barWidth >= 54) {
        const barFraction = bar.totalVolume / maxBarVolume;
        ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
        ctx.fillRect(x + 3, HEADER_HEIGHT - 3, (barWidth - 6) * barFraction, 2);
      }

      ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.bottom);
      ctx.stroke();

      for (const level of bar.levels) {
        const rowIndex = priceToIndex.get(level.price);
        if (rowIndex === undefined) continue;
        const y = plot.top + rowIndex * rowHeight - scrollRef.current;
        if (y + rowHeight < plot.top || y > plot.bottom) continue;
        drawLevelCell(ctx, level, x, y, barWidth, rowHeight, data);
      }
    }

    const pointer = pointerRef.current;
    if (pointer && pointer.x >= plot.left && pointer.x <= plot.right && pointer.y >= plot.top && pointer.y <= plot.bottom) {
      drawTooltip(ctx, plot, pointer, data, visible, start, barWidth, rowHeight, prices, scrollRef.current, priceToIndex);
    }

    ctx.fillStyle = HEADER;
    ctx.fillRect(0, height - FOOTER_HEIGHT, width, FOOTER_HEIGHT);
    ctx.fillStyle = TEXT_DIM;
    ctx.textAlign = "left";
    ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("wheel: rows · shift+wheel: bars · drag: pan", plot.left + 2, height - 5);
    ctx.textAlign = "right";
    const hidden = data.bars.length - visible.length;
    ctx.fillText(hidden > 0 ? `${hidden} older bars not shown` : "all collected bars shown", plot.right - 4, height - 5);
  }

  function drawLevelCell(
    ctx: CanvasRenderingContext2D,
    level: FootprintLevel,
    x: number,
    y: number,
    barWidth: number,
    rowHeight: number,
    data: FootprintCanvasProps,
  ): void {
    if (data.showImbalance && level.buyImbalance) {
      ctx.fillStyle = "rgba(45, 212, 191, 0.14)";
      ctx.fillRect(x + 1, y + 1, barWidth - 2, rowHeight - 2);
      ctx.fillStyle = "rgba(45, 212, 191, 0.65)";
      ctx.fillRect(x + 1, y + 1, 2, rowHeight - 2);
    } else if (data.showImbalance && level.sellImbalance) {
      ctx.fillStyle = "rgba(244, 63, 94, 0.14)";
      ctx.fillRect(x + 1, y + 1, barWidth - 2, rowHeight - 2);
      ctx.fillStyle = "rgba(244, 63, 94, 0.65)";
      ctx.fillRect(x + barWidth - 3, y + 1, 2, rowHeight - 2);
    }

    if (level.isPoc && data.showPoc) {
      ctx.strokeStyle = "rgba(224, 166, 60, 0.6)";
      ctx.strokeRect(x + 1.5, y + 1.5, barWidth - 3, rowHeight - 3);
    }

    const fontSize = barWidth < 44 ? 7 : barWidth < 58 ? 8 : 9;
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = "middle";
    const midY = y + rowHeight / 2 + 0.5;
    const separator = barWidth < 52 ? "|" : "×";

    if (barWidth < 40) {
      ctx.textAlign = "center";
      ctx.fillStyle = level.delta > 0 ? UP : level.delta < 0 ? DOWN : TEXT_DIM;
      ctx.fillText(level.delta !== 0 ? `${level.delta > 0 ? "+" : ""}${volumeLabel(Math.abs(level.delta))}` : volumeLabel(level.totalVolume), x + barWidth / 2, midY);
      ctx.textBaseline = "alphabetic";
      return;
    }

    const pairText = `${volumeLabel(level.sellVolume)}${separator}${volumeLabel(level.buyVolume)}`;
    const unknownText = data.showUnknown && level.unknownVolume > 0 ? `?${volumeLabel(level.unknownVolume)}` : "";
    const fullText = unknownText ? `${pairText} ${unknownText}` : pairText;

    ctx.textAlign = "center";
    ctx.fillStyle = "#CBD5E1";
    ctx.fillText(fullText, x + barWidth / 2, midY);
    ctx.textBaseline = "alphabetic";
  }

  function drawPriceLine(
    ctx: CanvasRenderingContext2D,
    plot: { left: number; right: number; top: number; bottom: number; width: number; height: number },
    rowIndex: number | undefined,
    rowHeight: number,
    color: string,
    label: string,
    scroll: number,
    totalHeight: number,
  ): void {
    if (rowIndex === undefined) return;
    const y = plot.top + rowIndex * rowHeight - scroll + rowHeight / 2;
    if (y < plot.top || y > plot.bottom || totalHeight <= 0) return;
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText(label, plot.right + 3, y - 3);
  }

  function nearestPrice(prices: number[], target: number): number {
    let best = prices[0] ?? target;
    let bestDistance = Math.abs(best - target);
    for (const price of prices) {
      const distance = Math.abs(price - target);
      if (distance < bestDistance) {
        best = price;
        bestDistance = distance;
      }
    }
    return best;
  }

  function drawTooltip(
    ctx: CanvasRenderingContext2D,
    plot: { left: number; right: number; top: number; bottom: number; width: number; height: number },
    pointer: { x: number; y: number },
    data: FootprintCanvasProps,
    visible: FootprintBar[],
    start: number,
    barWidth: number,
    rowHeight: number,
    prices: number[],
    scroll: number,
    priceToIndex: Map<number, number>,
  ): void {
    const column = Math.floor((pointer.x - plot.left) / barWidth);
    if (column < 0 || column >= visible.length) return;
    const row = Math.floor((pointer.y - plot.top + scroll) / rowHeight);
    if (row < 0 || row >= prices.length) return;
    const bar = visible[column];
    const price = prices[row];
    const level = bar.levels.find((l) => l.price === price);

    const lines = [
      `${shortTime(bar.startTime)} · ${price.toFixed(decimalPlaces(data.tickSize))}`,
      `bar Δ ${bar.delta >= 0 ? "+" : ""}${volumeLabel(Math.abs(bar.delta))} · vol ${volumeLabel(bar.totalVolume)} · POC ${bar.pocPrice?.toFixed(decimalPlaces(data.tickSize)) ?? "—"}`,
      level
        ? `sell ${volumeLabel(level.sellVolume)} · buy ${volumeLabel(level.buyVolume)} · unknown ${volumeLabel(level.unknownVolume)}`
        : "no print at this price in the bar",
      level?.buyImbalance
        ? "ask-side imbalance (buy volume dominates level below)"
        : level?.sellImbalance
          ? "bid-side imbalance (sell volume dominates level above)"
          : level?.isPoc
            ? "bar POC"
            : `${data.session.sideCoverage.inferredPct.toFixed(0)}% of volume has an inferred side`,
    ];

    const boxWidth = 252;
    const boxHeight = 15 * lines.length + 8;
    const boxX = Math.min(plot.right - boxWidth - 4, pointer.x + 14);
    const boxY = Math.min(plot.bottom - boxHeight - 4, pointer.y + 14);
    ctx.fillStyle = "rgba(4, 8, 12, 0.92)";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
    ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    lines.forEach((line, index) => {
      ctx.fillStyle = index === 0 ? "#E2E8F0" : index === 1 ? (bar.delta >= 0 ? UP : DOWN) : TEXT;
      ctx.fillText(line, boxX + 8, boxY + 16 + index * 15);
    });

    void start;
    void priceToIndex;
  }

  return (
    <div ref={wrapRef} className="relative h-full min-h-[320px] w-full">
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" aria-label={`Footprint chart for ${props.symbol}`} />
    </div>
  );
}
