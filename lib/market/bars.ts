import type { DataStatus } from "@/lib/market/status";

export interface Bar {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsResult {
  symbol: string;
  contractSymbol?: string;
  timeframe: string;
  source: string;
  dataStatus: DataStatus;
  bars: Bar[];
  reason?: string;
}

export interface TradeBarInput {
  price: number;
  size: number;
  eventTimestamp: string;
}

export function barsFromTrades(trades: TradeBarInput[], timeframeSec: number): Bar[] {
  const step = Math.max(1, Math.round(timeframeSec));
  const buckets = new Map<number, Bar>();
  const ordered = [...trades].sort(
    (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
  );
  for (const trade of ordered) {
    const ms = new Date(trade.eventTimestamp).getTime();
    if (!Number.isFinite(ms) || !Number.isFinite(trade.price) || !Number.isFinite(trade.size)) continue;
    const time = Math.floor(ms / 1000 / step) * step;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, {
        time,
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: trade.size,
      });
    } else {
      existing.high = Math.max(existing.high, trade.price);
      existing.low = Math.min(existing.low, trade.price);
      existing.close = trade.price;
      existing.volume += trade.size;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

const TF_SECONDS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic SYNTHETIC bars for the chart workspace. Only returned when
 * FYIP_ENABLE_FIXTURES=true and always flagged `simulated`. These bars are
 * generated for UI development and must never be treated as real history.
 * Real bars are expected from the NinjaTrader bridge (historical data request)
 * or a licensed historical feed — see docs/DATA_ARCHITECTURE.md.
 */
export function syntheticBars(symbol: string, timeframe: string, count: number): Bar[] {
  const step = TF_SECONDS[timeframe] ?? 300;
  const rand = mulberry32(hash(symbol + timeframe));
  const anchor = 100 + (hash(symbol) % 4000) / 10;
  const now = Math.floor(Date.now() / 1000);
  const start = now - step * count;
  let price = anchor;
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const drift = (rand() - 0.5) * anchor * 0.01;
    const open = price;
    const close = Math.max(0.01, open + drift);
    const high = Math.max(open, close) + rand() * anchor * 0.004;
    const low = Math.min(open, close) - rand() * anchor * 0.004;
    bars.push({
      time: start + i * step,
      open: round(open), high: round(high), low: round(low), close: round(close),
      volume: Math.floor(rand() * 10000),
    });
    price = close;
  }
  return bars;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function timeframeSeconds(tf: string): number {
  return TF_SECONDS[tf] ?? 300;
}

export const TIMEFRAMES = Object.keys(TF_SECONDS);