import type { Bar } from "@/lib/market/bars";

export interface WeightedLevel {
  price: number;
  total: number;
}

export interface ValueArea {
  pocPrice: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
}

export function computeValueArea(levels: WeightedLevel[], pct = 0.7): ValueArea {
  const sorted = [...levels].filter((l) => l.total > 0).sort((a, b) => b.price - a.price);
  if (sorted.length === 0) return { pocPrice: null, valueAreaHigh: null, valueAreaLow: null };

  const total = sorted.reduce((sum, l) => sum + l.total, 0);
  let pocIndex = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i].total > sorted[pocIndex].total) pocIndex = i;

  const included = new Set<number>([pocIndex]);
  let covered = sorted[pocIndex].total;
  const target = total * Math.min(1, Math.max(0, pct));
  let above = pocIndex - 1;
  let below = pocIndex + 1;

  while (covered < target && (above >= 0 || below < sorted.length)) {
    const aboveVolume = above >= 0 ? sorted[above].total : -1;
    const belowVolume = below < sorted.length ? sorted[below].total : -1;
    if (aboveVolume >= belowVolume) {
      included.add(above);
      covered += aboveVolume;
      above -= 1;
    } else {
      included.add(below);
      covered += belowVolume;
      below += 1;
    }
  }

  const prices = [...included].map((i) => sorted[i].price);
  return {
    pocPrice: sorted[pocIndex].price,
    valueAreaHigh: Math.max(...prices),
    valueAreaLow: Math.min(...prices),
  };
}

export interface VwapPoint {
  time: number;
  value: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
}

export function vwapFromBars(bars: Bar[]): VwapPoint[] {
  const points: VwapPoint[] = [];
  let pv = 0;
  let volume = 0;
  let varianceWeighted = 0;

  for (const bar of bars) {
    const typical = (bar.high + bar.low + bar.close) / 3;
    pv += typical * bar.volume;
    volume += bar.volume;
    if (volume <= 0) continue;
    const vwap = pv / volume;
    varianceWeighted += bar.volume * (typical - vwap) * (typical - vwap);
    const deviation = Math.sqrt(varianceWeighted / volume);
    points.push({
      time: bar.time,
      value: vwap,
      upper1: vwap + deviation,
      lower1: vwap - deviation,
      upper2: vwap + deviation * 2,
      lower2: vwap - deviation * 2,
    });
  }
  return points;
}

export function simpleSma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function simpleEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      seed += values[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = values[i] * k + (prev as number) * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface FibLevel {
  ratio: number;
  price: number;
  label: string;
}

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

export function fibLevels(startPrice: number, endPrice: number): FibLevel[] {
  return FIB_RATIOS.map((ratio) => ({
    ratio,
    price: endPrice + (startPrice - endPrice) * ratio,
    label: `${Math.round(ratio * 1000) / 10}%`,
  }));
}

export interface VolumeProfileBin {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
}

export interface VolumeProfile {
  bins: VolumeProfileBin[];
  totalVolume: number;
  pocPrice: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
  rowStep: number;
}

export interface ProfileTrade {
  price: number;
  size: number;
  side: "buy" | "sell" | "cross" | null;
}

export function volumeProfileFromTrades(
  trades: ProfileTrade[],
  options: { tickSize?: number; rowTicks?: number } = {},
): VolumeProfile {
  const step = Math.max(options.tickSize ?? 0.01, 1e-8) * Math.max(1, Math.round(options.rowTicks ?? 1));
  const bins = new Map<number, VolumeProfileBin>();

  for (const trade of trades) {
    if (!Number.isFinite(trade.price) || !Number.isFinite(trade.size) || trade.size <= 0) continue;
    const key = Math.round(trade.price / step);
    let bin = bins.get(key);
    if (!bin) {
      bin = {
        price: Math.round(key * step * 1e8) / 1e8,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        unknownVolume: 0,
      };
      bins.set(key, bin);
    }
    bin.volume += trade.size;
    if (trade.side === "buy") bin.buyVolume += trade.size;
    else if (trade.side === "sell") bin.sellVolume += trade.size;
    else bin.unknownVolume += trade.size;
  }

  const descending = [...bins.values()].sort((a, b) => b.price - a.price);
  const valueArea = computeValueArea(
    descending.map((bin) => ({ price: bin.price, total: bin.volume })),
    0.7,
  );
  return {
    bins: descending.reverse(),
    totalVolume: descending.reduce((sum, bin) => sum + bin.volume, 0),
    pocPrice: valueArea.pocPrice,
    valueAreaHigh: valueArea.valueAreaHigh,
    valueAreaLow: valueArea.valueAreaLow,
    rowStep: step,
  };
}
