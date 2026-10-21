"use client";

import { useEffect, useRef, useState } from "react";
import type { IChartApi } from "lightweight-charts";

/**
 * Lightweight-charts wrapper. The library is dynamically imported inside an
 * effect so it never runs during SSR. Indicators are computed by FYIP and
 * plotted as overlay series; they are not vendor data.
 */
export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function ChartPanel({
  bars,
  studies,
  height = 420,
}: {
  bars: ChartBar[];
  studies: { sma: boolean; ema: boolean; volume: boolean };
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    let chart: IChartApi | null = null;
    let resize: ResizeObserver | null = null;

    (async () => {
      const lib = await import("lightweight-charts");
      if (disposed || !ref.current) return;
      chart = lib.createChart(ref.current, {
        layout: { background: { color: "#0C0E12" }, textColor: "#9AA3AF" },
        grid: { vertLines: { color: "#1E232C" }, horzLines: { color: "#1E232C" } },
        rightPriceScale: { borderColor: "#1E232C" },
        timeScale: { borderColor: "#1E232C", timeVisible: true, secondsVisible: false },
        crosshair: { mode: 1 },
        autoSize: false,
      });
      chartApi.current = chart;

      const candle = chart.addCandlestickSeries({
        upColor: "#22A06B", downColor: "#E5484D", borderVisible: false,
        wickUpColor: "#22A06B", wickDownColor: "#E5484D",
      });
      candle.setData(bars.map((b) => ({ time: b.time as never, open: b.open, high: b.high, low: b.low, close: b.close })));

      if (studies.volume) {
        const vol = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol" });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        vol.setData(bars.map((b) => ({ time: b.time as never, value: b.volume, color: b.close >= b.open ? "rgba(34,160,107,0.4)" : "rgba(229,72,77,0.4)" })));
      }

      const closeSeries = bars.map((b) => b.close);
      const toLine = (values: (number | null)[]) =>
        values
          .map((v, i) => (v === null ? null : { time: bars[i].time as never, value: v }))
          .filter((p): p is { time: never; value: number } => p !== null);
      if (studies.sma) {
        const s = chart.addLineSeries({ color: "#E0A63C", lineWidth: 1 });
        s.setData(toLine(simpleSma(closeSeries, 20)));
      }
      if (studies.ema) {
        const s = chart.addLineSeries({ color: "#3E8FB0", lineWidth: 1 });
        s.setData(toLine(simpleEma(closeSeries, 50)));
      }

      chart.timeScale().fitContent();
      resize = new ResizeObserver(() => {
        if (ref.current && chart) chart.applyOptions({ width: ref.current.clientWidth, height });
      });
      resize.observe(ref.current);
      setReady(true);
    })();

    return () => {
      disposed = true;
      resize?.disconnect();
      if (chart) chart.remove();
      chartApi.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, studies.sma, studies.ema, studies.volume, height]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" style={{ height }} />
      {!ready && <div className="absolute inset-0 flex items-center justify-center font-mono text-3xs uppercase tracking-widest text-ink-faint">initialising chart…</div>}
    </div>
  );
}

function simpleSma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function simpleEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      seed += values[i];
      if (i === period - 1) { prev = seed / period; out[i] = prev; }
      continue;
    }
    prev = values[i] * k + (prev as number) * (1 - k);
    out[i] = prev;
  }
  return out;
}