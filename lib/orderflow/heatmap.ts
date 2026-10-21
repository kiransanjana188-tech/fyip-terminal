export interface HeatLevel {
  price: number;
  volume: number;
}

export interface HeatSnapshot {
  eventTimestamp: string;
  receivedTimestamp?: string;
  bids: HeatLevel[];
  asks: HeatLevel[];
}

export interface HeatTrade {
  eventTimestamp: string;
  price: number;
  size: number;
  side: "buy" | "sell" | "cross" | null;
  sideSource?: "provider" | "inferred" | "unknown";
}

export interface HeatGap {
  from: number;
  to: number;
  ms: number;
}

export type HeatScale = "linear" | "sqrt" | "log";

export function snapshotTime(snapshot: HeatSnapshot): number {
  return new Date(snapshot.eventTimestamp).getTime();
}

/** True when the best bid is at or above the best ask (crossed/locked book). */
export function isCrossedBook(bids: HeatLevel[], asks: HeatLevel[]): boolean {
  if (bids.length === 0 || asks.length === 0) return false;
  let bestBid = Number.NEGATIVE_INFINITY;
  let bestAsk = Number.POSITIVE_INFINITY;
  for (const level of bids) if (level.price > bestBid) bestBid = level.price;
  for (const level of asks) if (level.price < bestAsk) bestAsk = level.price;
  return bestBid >= bestAsk;
}

export function heatPriceRange(snapshots: HeatSnapshot[], trades: HeatTrade[] = []): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const snapshot of snapshots) {
    for (const level of snapshot.bids) {
      if (Number.isFinite(level.price)) {
        min = Math.min(min, level.price);
        max = Math.max(max, level.price);
      }
    }
    for (const level of snapshot.asks) {
      if (Number.isFinite(level.price)) {
        min = Math.min(min, level.price);
        max = Math.max(max, level.price);
      }
    }
  }
  for (const trade of trades) {
    if (Number.isFinite(trade.price)) {
      min = Math.min(min, trade.price);
      max = Math.max(max, trade.price);
    }
  }
  return min <= max ? { min, max } : null;
}

export function heatTimeBounds(items: Array<HeatSnapshot | HeatTrade>): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const time = new Date(item.eventTimestamp).getTime();
    if (!Number.isFinite(time)) continue;
    from = Math.min(from, time);
    to = Math.max(to, time);
  }
  return from <= to ? { from, to } : null;
}

export function heatIntensity(volume: number, maxVolume: number, scale: HeatScale = "sqrt"): number {
  if (!Number.isFinite(volume) || volume <= 0 || !Number.isFinite(maxVolume) || maxVolume <= 0) return 0;
  const ratio = Math.min(1, volume / maxVolume);
  if (scale === "linear") return ratio;
  if (scale === "log") return Math.log1p(volume) / Math.log1p(maxVolume);
  return Math.sqrt(ratio);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function heatGaps(snapshots: HeatSnapshot[], expectedMs?: number): HeatGap[] {
  const times = [...new Set(snapshots.map(snapshotTime).filter(Number.isFinite))].sort((a, b) => a - b);
  if (times.length < 2) return [];
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    if (delta > 0) deltas.push(delta);
  }
  const baseline = expectedMs ?? median(deltas);
  if (!Number.isFinite(baseline) || baseline <= 0) return [];
  const threshold = Math.max(baseline * 3, 5000);
  const gaps: HeatGap[] = [];
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    if (delta > threshold) gaps.push({ from: times[i - 1], to: times[i], ms: delta });
  }
  return gaps;
}

export function mergeSnapshots(existing: HeatSnapshot[], incoming: HeatSnapshot[], max = 4000): HeatSnapshot[] {
  const byTime = new Map<number, HeatSnapshot>();
  for (const snapshot of existing) {
    const time = snapshotTime(snapshot);
    if (Number.isFinite(time)) byTime.set(time, snapshot);
  }
  for (const snapshot of incoming) {
    const time = snapshotTime(snapshot);
    if (Number.isFinite(time)) byTime.set(time, snapshot);
  }
  const merged = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([, snapshot]) => snapshot);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

export function mergeTrades(existing: HeatTrade[], incoming: HeatTrade[], max = 5000): HeatTrade[] {
  const seen = new Set(existing.map(tradeKey));
  const merged = [...existing];
  for (const trade of incoming) {
    const key = tradeKey(trade);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trade);
  }
  merged.sort((a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime());
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

function tradeKey(trade: HeatTrade): string {
  return `${trade.eventTimestamp}|${trade.price}|${trade.size}|${trade.side ?? "null"}`;
}

export function priceTicks(min: number, max: number, tickSize: number, target = 10): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  const span = max - min;
  const step = Math.max(tickSize, span / Math.max(1, target));
  const roundedStep = Math.max(tickSize, Math.ceil(step / tickSize) * tickSize);
  const first = Math.ceil(min / roundedStep) * roundedStep;
  const ticks: number[] = [];
  for (let value = first; value <= max + roundedStep * 0.001 && ticks.length < 64; value += roundedStep) {
    ticks.push(Math.round(value * 1e8) / 1e8);
  }
  return ticks;
}
