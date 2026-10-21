"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import {
  fibLevels,
  rsi as rsiSeries,
  simpleEma,
  simpleSma,
  volumeProfileFromTrades,
  vwapFromBars,
  type VolumeProfile,
} from "@/lib/orderflow/studies";

export type ChartType = "candles" | "line" | "area" | "bars";

export type ChartDrawingKind =
  | "hline"
  | "vline"
  | "trend"
  | "ray"
  | "rect"
  | "fib"
  | "channel"
  | "text"
  | "measure";

export type ChartTool = "cursor" | ChartDrawingKind;

export interface ChartPoint {
  time: number;
  price: number;
}

export interface ChartDrawing {
  id: string;
  kind: ChartDrawingKind;
  points: ChartPoint[];
  text?: string;
}

export interface ChartStudies {
  sma: boolean;
  ema: boolean;
  vwap: boolean;
  volume: boolean;
  profile: boolean;
  rsi: boolean;
}

export interface ChartBarPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartTradePoint {
  price: number;
  size: number;
  side: "buy" | "sell" | "cross" | null;
  eventTimestamp: string;
}

export interface AdvancedChartProps {
  symbol: string;
  bars: ChartBarPoint[];
  trades: ChartTradePoint[];
  tickSize: number;
  priceScale: number;
  chartType: ChartType;
  studies: ChartStudies;
  tool: ChartTool;
  drawings: ChartDrawing[];
  onDrawingsChange: (drawings: ChartDrawing[]) => void;
}

const POINTS_REQUIRED: Record<ChartDrawingKind, number> = {
  hline: 1,
  vline: 1,
  trend: 2,
  ray: 2,
  rect: 2,
  fib: 2,
  channel: 3,
  text: 1,
  measure: 2,
};

const DRAWING_COLOR: Record<ChartDrawingKind, string> = {
  hline: "#E0A63C",
  vline: "#3E8FB0",
  trend: "#E0A63C",
  ray: "#22C55E",
  rect: "#3E8FB0",
  fib: "#A78BFA",
  channel: "#38BDF8",
  text: "#E2E8F0",
  measure: "#94A3B8",
};

function drawingId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function formatPrice(value: number, scale: number): string {
  return value.toFixed(Math.min(8, Math.max(0, scale)));
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 7;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - Math.PI / 7), y2 - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 7), y2 - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

export function AdvancedChart(props: AdvancedChartProps) {
  const { bars, chartType, studies, tool, drawings, trades, tickSize, priceScale } = props;
  const mainHostRef = useRef<HTMLDivElement>(null);
  const lowerHostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick" | "Line" | "Area" | "Bar"> | null>(null);
  const lowerChartRef = useRef<IChartApi | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const pendingRef = useRef<ChartPoint[]>([]);
  const hoverRef = useRef<ChartPoint | null>(null);
  const toolRef = useRef(tool);
  const drawingsRef = useRef(drawings);
  const tradesRef = useRef(trades);
  const studiesRef = useRef(studies);
  const scaleRef = useRef(priceScale);
  const onDrawingsChangeRef = useRef(props.onDrawingsChange);
  const [lowerHeight, setLowerHeight] = useState(118);
  const [chartVersion, setChartVersion] = useState(0);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  toolRef.current = tool;
  drawingsRef.current = drawings;
  tradesRef.current = trades;
  studiesRef.current = studies;
  scaleRef.current = priceScale;
  onDrawingsChangeRef.current = props.onDrawingsChange;

  useEffect(() => {
    const host = mainHostRef.current;
    if (!host) return;
    let disposed = false;
    let chart: IChartApi | null = null;
    let lower: IChartApi | null = null;
    let overlayObserver: ResizeObserver | null = null;
    const unsubscribers: (() => void)[] = [];

    (async () => {
      const lib = await import("lightweight-charts");
      if (disposed || !host) return;
      const { ColorType, CrosshairMode, LineStyle, createChart } = lib;

      chart = createChart(host, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "#0C0E12" },
          textColor: "#9AA3AF",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 10,
        },
        grid: { vertLines: { color: "#1E232C" }, horzLines: { color: "#1E232C" } },
        rightPriceScale: { borderColor: "#1E232C", scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: { borderColor: "#1E232C", timeVisible: true, secondsVisible: false, rightOffset: 8 },
        crosshair: { mode: CrosshairMode.Normal },
        handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true, vertTouchDrag: false },
      });
      chartRef.current = chart;

      let series: ISeriesApi<"Candlestick" | "Line" | "Area" | "Bar">;
      if (chartType === "line") {
        series = chart.addLineSeries({ color: "#E0A63C", lineWidth: 2 });
        series.setData(bars.map((bar) => ({ time: bar.time as Time, value: bar.close })));
      } else if (chartType === "area") {
        series = chart.addAreaSeries({
          lineColor: "#E0A63C",
          topColor: "rgba(224, 166, 60, 0.28)",
          bottomColor: "rgba(224, 166, 60, 0.02)",
          lineWidth: 2,
        });
        series.setData(bars.map((bar) => ({ time: bar.time as Time, value: bar.close })));
      } else if (chartType === "bars") {
        series = chart.addBarSeries({ upColor: "#22A06B", downColor: "#E5484D" });
        series.setData(
          bars.map((bar) => ({
            time: bar.time as Time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })),
        );
      } else {
        series = chart.addCandlestickSeries({
          upColor: "#22A06B",
          downColor: "#E5484D",
          borderVisible: false,
          wickUpColor: "#22A06B",
          wickDownColor: "#E5484D",
        });
        series.setData(
          bars.map((bar) => ({
            time: bar.time as Time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          })),
        );
      }
      seriesRef.current = series;

      if (studies.volume) {
        const volume = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volume.setData(
          bars.map((bar) => ({
            time: bar.time as Time,
            value: bar.volume,
            color: bar.close >= bar.open ? "rgba(34,160,107,0.35)" : "rgba(229,72,77,0.35)",
          })),
        );
      }

      const closes = bars.map((bar) => bar.close);
      const addLine = (values: (number | null)[], color: string, width: 1 | 2, dash = false) => {
        const line = chart!.addLineSeries({
          color,
          lineWidth: width,
          priceLineVisible: false,
          lastValueVisible: false,
          lineStyle: dash ? LineStyle.Dashed : LineStyle.Solid,
        });
        line.setData(
          values
            .map((value, index) => (value === null ? null : { time: bars[index].time as Time, value }))
            .filter((point): point is { time: Time; value: number } => point !== null),
        );
      };

      if (studies.sma) addLine(simpleSma(closes, 20), "#E0A63C", 1);
      if (studies.ema) addLine(simpleEma(closes, 50), "#3E8FB0", 1);
      if (studies.vwap) {
        const vwap = vwapFromBars(bars);
        addLine(vwap.map((point) => point.value), "#38BDF8", 2);
        addLine(vwap.map((point) => point.upper1), "rgba(56,189,248,0.45)", 1, true);
        addLine(vwap.map((point) => point.lower1), "rgba(56,189,248,0.45)", 1, true);
        addLine(vwap.map((point) => point.upper2), "rgba(56,189,248,0.25)", 1, true);
        addLine(vwap.map((point) => point.lower2), "rgba(56,189,248,0.25)", 1, true);
      }

      chart.timeScale().fitContent();

      if (studies.rsi && lowerHostRef.current) {
        lower = createChart(lowerHostRef.current, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: "#0C0E12" },
            textColor: "#64748B",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 9,
          },
          grid: { vertLines: { color: "#141820" }, horzLines: { color: "#141820" } },
          rightPriceScale: { borderColor: "#1E232C", scaleMargins: { top: 0.12, bottom: 0.12 } },
          timeScale: { visible: false, borderColor: "#1E232C" },
          crosshair: { mode: CrosshairMode.Normal },
          handleScale: false,
        });
        lowerChartRef.current = lower;
        const line = lower.addLineSeries({ color: "#A78BFA", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
        line.setData(
          rsiSeries(closes, 14)
            .map((value, index) => (value === null ? null : { time: bars[index].time as Time, value }))
            .filter((point): point is { time: Time; value: number } => point !== null),
        );
        line.createPriceLine({ price: 70, color: "rgba(229,72,77,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "70" });
        line.createPriceLine({ price: 30, color: "rgba(34,160,107,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "30" });
        lower.timeScale().fitContent();

        let syncing = false;
        const syncFromMain = (range: { from: number; to: number } | null) => {
          if (syncing || !lower || !range) return;
          syncing = true;
          lower.timeScale().setVisibleLogicalRange(range);
          syncing = false;
        };
        const syncFromLower = (range: { from: number; to: number } | null) => {
          if (syncing || !chart || !range) return;
          syncing = true;
          chart.timeScale().setVisibleLogicalRange(range);
          syncing = false;
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(syncFromMain);
        lower.timeScale().subscribeVisibleLogicalRangeChange(syncFromLower);
        unsubscribers.push(() => {
          chart?.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromMain);
          lower?.timeScale().unsubscribeVisibleLogicalRangeChange(syncFromLower);
        });
      }

      const redrawOnMove = () => redrawRef.current();
      chart.timeScale().subscribeVisibleLogicalRangeChange(redrawOnMove);
      unsubscribers.push(() => chart?.timeScale().unsubscribeVisibleLogicalRangeChange(redrawOnMove));

      const canvas = overlayRef.current;
      if (canvas) {
        overlayObserver = new ResizeObserver(() => {
          const rect = canvas.getBoundingClientRect();
          const dpr = window.devicePixelRatio || 1;
          canvas.width = Math.max(1, Math.round(rect.width * dpr));
          canvas.height = Math.max(1, Math.round(rect.height * dpr));
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          redrawRef.current();
        });
        overlayObserver.observe(canvas);
      }
      setChartVersion((version) => version + 1);
    })();

    return () => {
      disposed = true;
      overlayObserver?.disconnect();
      for (const off of unsubscribers) off();
      if (lower) lower.remove();
      if (chart) chart.remove();
      chartRef.current = null;
      lowerChartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, chartType, studies.sma, studies.ema, studies.vwap, studies.volume, studies.rsi]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!canvas || !chart || !series) return;

    function toX(time: number): number | null {
      const x = chart!.timeScale().timeToCoordinate(time as Time);
      return x === null ? null : x;
    }
    function toY(price: number): number | null {
      const y = series!.priceToCoordinate(price);
      return y === null ? null : y;
    }
    function plotRight(): number {
      return chart!.timeScale().width();
    }

    function render(): void {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      const width = canvas!.clientWidth;
      const height = canvas!.clientHeight;
      ctx.clearRect(0, 0, width, height);

      if (studiesRef.current.profile && tradesRef.current.length > 0) {
        drawProfile(ctx, width);
      }

      for (const drawing of drawingsRef.current) drawDrawing(ctx, drawing, width, height);

      const preview = pendingRef.current;
      const hover = hoverRef.current;
      const activeTool = toolRef.current;
      if (activeTool !== "cursor" && hover) {
        const previewPoints = [...preview, hover];
        if (previewPoints.length >= 1) {
          const kind = activeTool;
          if (kind === "hline" && previewPoints.length === 1) {
            previewDrawing(ctx, { id: "preview", kind, points: previewPoints }, width, height);
          } else if (kind === "vline" && previewPoints.length === 1) {
            previewDrawing(ctx, { id: "preview", kind, points: previewPoints }, width, height);
          } else if (kind !== "text" && previewPoints.length >= 2) {
            previewDrawing(ctx, { id: "preview", kind, points: previewPoints }, width, height);
          }
        }
      }
    }

    function drawProfile(ctx: CanvasRenderingContext2D, width: number): void {
      const profile = volumeProfileFromTrades(tradesRef.current, { tickSize, rowTicks: 2 });
      if (profile.totalVolume <= 0) return;
      const maxBin = Math.max(...profile.bins.map((bin) => bin.volume), 1);
      const right = plotRight();
      const maxWidth = Math.max(44, width * 0.16);
      const origin = Math.min(right, width - 58) - 6;
      const rowHeight = Math.max(1, Math.abs((toY(0) ?? 0) - (toY(tickSize * 2) ?? 1)));

      for (const bin of profile.bins) {
        const y = toY(bin.price);
        if (y === null) continue;
        const barWidth = (bin.volume / maxBin) * maxWidth;
        const isPoc = profile.pocPrice === bin.price;
        const buyRatio = bin.volume > 0 ? bin.buyVolume / bin.volume : 0;
        ctx.fillStyle = isPoc ? "rgba(224, 166, 60, 0.55)" : buyRatio >= 0.5 ? "rgba(34, 160, 107, 0.22)" : "rgba(229, 72, 77, 0.22)";
        ctx.fillRect(origin - barWidth, y - rowHeight / 2, barWidth, Math.max(1, rowHeight - 0.5));
        if (isPoc) {
          ctx.strokeStyle = "rgba(224, 166, 60, 0.9)";
          ctx.strokeRect(origin - barWidth, y - rowHeight / 2, barWidth, Math.max(1, rowHeight - 0.5));
        }
      }

      if (profile.valueAreaHigh !== null && profile.valueAreaLow !== null) {
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.setLineDash([3, 4]);
        for (const price of [profile.valueAreaHigh, profile.valueAreaLow]) {
          const y = toY(price);
          if (y === null) continue;
          ctx.beginPath();
          ctx.moveTo(origin - maxWidth, y);
          ctx.lineTo(origin, y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
      ctx.textAlign = "right";
      ctx.fillText(`VP ${formatPrice(profile.pocPrice ?? 0, scaleRef.current)}`, origin, 12);
    }

    function previewDrawing(
      ctx: CanvasRenderingContext2D,
      drawing: ChartDrawing,
      width: number,
      height: number,
    ): void {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([4, 4]);
      drawDrawing(ctx, drawing, width, height);
      ctx.restore();
    }

    function drawDrawing(ctx: CanvasRenderingContext2D, drawing: ChartDrawing, width: number, height: number): void {
      if (drawing.points.length === 0) return;
      const color = DRAWING_COLOR[drawing.kind];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.4;
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "left";

      const coordinates = drawing.points.map((point) => {
        const x = toX(point.time);
        const y = toY(point.price);
        return x === null || y === null ? null : { x, y };
      });
      const valid = coordinates.filter((point): point is { x: number; y: number } => point !== null);
      if (valid.length < drawing.points.length) return;

      if (drawing.kind === "hline") {
        const y = valid[0].y;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotRight(), y);
        ctx.stroke();
        label(ctx, formatPrice(drawing.points[0].price, scaleRef.current), plotRight() - 4, y - 4, color, "right");
        return;
      }
      if (drawing.kind === "vline") {
        const x = valid[0].x;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        return;
      }
      if (drawing.kind === "text") {
        const text = drawing.text ?? "note";
        ctx.fillStyle = "rgba(12, 14, 18, 0.85)";
        ctx.fillRect(valid[0].x + 5, valid[0].y - 16, Math.max(24, text.length * 6 + 8), 16);
        ctx.fillStyle = color;
        ctx.fillText(text, valid[0].x + 9, valid[0].y - 5);
        return;
      }
      if (drawing.kind === "rect" && valid.length >= 2) {
        const [a, b] = valid;
        ctx.fillStyle = "rgba(62, 143, 176, 0.08)";
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        return;
      }
      if (drawing.kind === "trend" && valid.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(valid[0].x, valid[0].y);
        ctx.lineTo(valid[1].x, valid[1].y);
        ctx.stroke();
        return;
      }
      if (drawing.kind === "ray" && valid.length >= 2) {
        const [a, b] = valid;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const targetX = plotRight();
        if (Math.abs(dx) < 0.001) return;
        const t = (targetX - a.x) / dx;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + dx * t, a.y + dy * t);
        ctx.stroke();
        return;
      }
      if (drawing.kind === "fib" && valid.length >= 2) {
        const [a, b] = valid;
        const levels = fibLevels(drawing.points[0].price, drawing.points[1].price);
        const left = Math.min(a.x, b.x);
        const right = Math.max(plotRight(), Math.max(a.x, b.x));
        for (const level of levels) {
          const y = toY(level.price);
          if (y === null) continue;
          ctx.strokeStyle = level.ratio <= 1 ? "rgba(167, 139, 250, 0.5)" : "rgba(167, 139, 250, 0.3)";
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          ctx.fillStyle = "rgba(196, 181, 253, 0.8)";
          ctx.fillText(`${level.label} ${formatPrice(level.price, scaleRef.current)}`, left + 4, y - 3);
        }
        return;
      }
      if (drawing.kind === "channel" && valid.length >= 3) {
        const [a, b, c] = valid;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) < 0.001) return;
        const offsetY = c.y - (a.y + ((c.x - a.x) * dy) / dx);
        const targetX = plotRight();
        const t = (targetX - a.x) / dx;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + dx * t, a.y + dy * t);
        ctx.moveTo(a.x, a.y + offsetY);
        ctx.lineTo(a.x + dx * t, a.y + offsetY + dy * t);
        ctx.stroke();
        ctx.fillStyle = "rgba(56, 189, 248, 0.06)";
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + dx * t, a.y + dy * t);
        ctx.lineTo(a.x + dx * t, a.y + offsetY + dy * t);
        ctx.lineTo(a.x, a.y + offsetY);
        ctx.closePath();
        ctx.fill();
        return;
      }
      if (drawing.kind === "measure" && valid.length >= 2) {
        const [a, b] = valid;
        drawArrow(ctx, a.x, a.y, b.x, b.y, color);
        const priceDelta = drawing.points[1].price - drawing.points[0].price;
        const pct = drawing.points[0].price !== 0 ? (priceDelta / drawing.points[0].price) * 100 : 0;
        const seconds = Math.abs(drawing.points[1].time - drawing.points[0].time);
        const text = `${priceDelta >= 0 ? "+" : ""}${formatPrice(priceDelta, scaleRef.current)} (${pct.toFixed(2)}%) · ${Math.round(seconds / 60)}m`;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        ctx.fillStyle = "rgba(12, 14, 18, 0.9)";
        ctx.fillRect(midX + 6, midY - 14, Math.max(70, text.length * 5.6), 14);
        ctx.fillStyle = color;
        ctx.fillText(text, midX + 10, midY - 3);
      }
    }

    function label(
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      color: string,
      align: CanvasTextAlign,
    ): void {
      ctx.fillStyle = "rgba(12, 14, 18, 0.8)";
      ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
      const width = text.length * 5.6 + 6;
      const left = align === "right" ? x - width : x;
      ctx.fillRect(left, y - 9, width, 12);
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
      ctx.textAlign = "left";
    }

    redrawRef.current = render;
    render();
  }, [drawings, trades, studies.profile, lowerHeight, tickSize, chartVersion]);

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    function eventPoint(event: PointerEvent): ChartPoint | null {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return null;
      const rect = canvas!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const time = chart.timeScale().coordinateToTime(x);
      const price = series.coordinateToPrice(y);
      if (time === null || price === null || !Number.isFinite(price)) return null;
      return { time: Number(time), price };
    }

    function onMove(event: PointerEvent): void {
      hoverRef.current = eventPoint(event);
      redrawRef.current();
    }

    function onLeave(): void {
      hoverRef.current = null;
      redrawRef.current();
    }

    function addDrawing(kind: ChartDrawingKind, points: ChartPoint[], text?: string): void {
      const drawing: ChartDrawing = { id: drawingId(), kind, points, text };
      const next = [...drawingsRef.current, drawing];
      drawingsRef.current = next;
      onDrawingsChangeRef.current(next);
    }

    function onClick(event: MouseEvent): void {
      const activeTool = toolRef.current;
      if (activeTool === "cursor") return;
      const point = eventPointFromMouse(event);
      if (!point) return;
      if (activeTool === "text") {
        const text = window.prompt("Chart note", "");
        if (text && text.trim()) addDrawing("text", [point], text.trim().slice(0, 80));
        pendingRef.current = [];
        redrawRef.current();
        return;
      }
      const pending = [...pendingRef.current, point];
      const required = POINTS_REQUIRED[activeTool];
      if (pending.length >= required) {
        addDrawing(activeTool, pending.slice(0, required));
        pendingRef.current = [];
      } else {
        pendingRef.current = pending;
      }
      redrawRef.current();
    }

    function eventPointFromMouse(event: MouseEvent): ChartPoint | null {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return null;
      const rect = canvas!.getBoundingClientRect();
      const time = chart.timeScale().coordinateToTime(event.clientX - rect.left);
      const price = series.coordinateToPrice(event.clientY - rect.top);
      if (time === null || price === null || !Number.isFinite(price)) return null;
      return { time: Number(time), price };
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        pendingRef.current = [];
        hoverRef.current = null;
        redrawRef.current();
      }
    }

    const interactive = tool !== "cursor";
    canvas.style.pointerEvents = interactive ? "auto" : "none";
    canvas.style.cursor = interactive ? "crosshair" : "default";
    if (!interactive) {
      pendingRef.current = [];
      hoverRef.current = null;
      redrawRef.current();
      return;
    }
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    resizeRef.current = { startY: event.clientY, startHeight: lowerHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resizeMove(event: React.PointerEvent<HTMLDivElement>): void {
    const resize = resizeRef.current;
    if (!resize) return;
    setLowerHeight(Math.min(320, Math.max(70, resize.startHeight - (event.clientY - resize.startY))));
  }

  function endResize(event: React.PointerEvent<HTMLDivElement>): void {
    resizeRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* no capture */
    }
  }

  const hasData = bars.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={mainHostRef} className="h-full w-full" />
        <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
        {!hasData && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-2xs uppercase tracking-widest text-ink-faint">
            no bars
          </div>
        )}
      </div>
      {studies.rsi && (
        <>
          <div
            onPointerDown={startResize}
            onPointerMove={resizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            className="flex h-2 shrink-0 cursor-row-resize items-center justify-center border-y border-line bg-panel-2"
            title="Drag to resize the RSI pane"
          >
            <span className="h-[2px] w-10 bg-line-2" />
          </div>
          <div ref={lowerHostRef} className="shrink-0" style={{ height: lowerHeight }} />
        </>
      )}
    </div>
  );
}
