import { describe, expect, it } from "vitest";
import { classifyTradeSide, inferAggressor } from "../lib/orderflow/classify";
import { buildFootprint } from "../lib/orderflow/footprint";
import { heatGaps, heatIntensity, heatPriceRange, isCrossedBook, mergeSnapshots, mergeTrades, priceTicks } from "../lib/orderflow/heatmap";
import {
  computeValueArea,
  fibLevels,
  rsi,
  simpleEma,
  simpleSma,
  volumeProfileFromTrades,
  vwapFromBars,
} from "../lib/orderflow/studies";
import { barsFromTrades } from "../lib/market/bars";

const t0 = "2026-10-19T14:00:00.000Z";
const at = (seconds: number) => new Date(new Date(t0).getTime() + seconds * 1000).toISOString();

describe("aggressor classification", () => {
  it("keeps provider supplied sides", () => {
    expect(classifyTradeSide("buy", 100, 99, 101)).toEqual({ side: "buy", sideSource: "provider" });
    expect(classifyTradeSide("cross", 100, 99, 101)).toEqual({ side: "cross", sideSource: "provider" });
  });

  it("infers buy at/above the ask and sell at/below the bid", () => {
    expect(inferAggressor(101, 99.75, 100.25)).toBe("buy");
    expect(inferAggressor(99.5, 99.75, 100.25)).toBe("sell");
    expect(inferAggressor(100, 99.75, 100.25)).toBeNull();
    expect(classifyTradeSide(null, 101, 99.75, 100.25)).toEqual({ side: "buy", sideSource: "inferred" });
  });

  it("returns unknown when the book is missing", () => {
    expect(classifyTradeSide(null, 100, null, null)).toEqual({ side: null, sideSource: "unknown" });
    expect(classifyTradeSide(null, 100, 101, 99)).toEqual({ side: null, sideSource: "unknown" });
  });
});

describe("footprint aggregation", () => {
  const trades = [
    { price: 6200.25, size: 10, side: "buy" as const, sideSource: "inferred" as const, eventTimestamp: at(1) },
    { price: 6200.0, size: 5, side: "sell" as const, sideSource: "inferred" as const, eventTimestamp: at(2) },
    { price: 6200.25, size: 7, side: "buy" as const, sideSource: "provider" as const, eventTimestamp: at(61) },
    { price: 6200.5, size: 2, side: null, sideSource: "unknown" as const, eventTimestamp: at(62) },
  ];

  it("buckets prints into ordered bars with bid/ask volumes", () => {
    const result = buildFootprint(trades, { bucketMs: 60_000, tickSize: 0.25, imbalanceRatio: 3 });
    expect(result.bars).toHaveLength(2);
    const first = result.bars[0];
    expect(first.levels.map((l) => l.price)).toEqual([6200.25, 6200]);
    const top = first.levels[0];
    expect(top.buyVolume).toBe(10);
    expect(top.sellVolume).toBe(0);
    const second = first.levels[1];
    expect(second.sellVolume).toBe(5);
    expect(first.delta).toBe(5);
    expect(first.pocPrice).toBe(6200.25);
    expect(result.bars[1].cumulativeDelta).toBe(5 + 7);
    expect(result.bars[1].unknownVolume).toBe(2);
    expect(result.session.totalVolume).toBe(24);
    expect(result.session.delta).toBe(12);
    expect(result.session.prints).toBe(4);
    expect(result.session.sideCoverage.inferredPct).toBeCloseTo((15 / 24) * 100);
    expect(result.session.sideCoverage.providerPct).toBeCloseTo((7 / 24) * 100);
    expect(result.session.sideCoverage.unknownPct).toBeCloseTo((2 / 24) * 100);
    expect(result.session.classifiedPct).toBeCloseTo((22 / 24) * 100);
  });

  it("flags diagonal imbalances above the configured ratio", () => {
    const result = buildFootprint(
      [
        { price: 100, size: 300, side: "buy", eventTimestamp: at(1) },
        { price: 99.75, size: 50, side: "sell", eventTimestamp: at(2) },
      ],
      { bucketMs: 60_000, tickSize: 0.25, imbalanceRatio: 3 },
    );
    const levels = result.bars[0].levels;
    expect(levels[0].buyImbalance).toBe(true);
    expect(levels[0].sellImbalance).toBe(false);
    expect(levels[1].sellImbalance).toBe(false);
  });

  it("groups prices by multiple ticks", () => {
    const result = buildFootprint(
      [
        { price: 6200.1, size: 4, side: "buy", eventTimestamp: at(1) },
        { price: 6200.2, size: 6, side: "sell", eventTimestamp: at(2) },
      ],
      { bucketMs: 60_000, tickSize: 0.25, rowTicks: 2 },
    );
    expect(result.rowStep).toBe(0.5);
    expect(result.bars[0].levels).toHaveLength(1);
    expect(result.bars[0].levels[0].buyVolume).toBe(4);
    expect(result.bars[0].levels[0].sellVolume).toBe(6);
  });
});

describe("value area and profiles", () => {
  it("expands around the POC until 70% of volume is covered", () => {
    const area = computeValueArea(
      [
        { price: 100, total: 10 },
        { price: 99, total: 60 },
        { price: 98, total: 20 },
        { price: 97, total: 10 },
      ],
      0.7,
    );
    expect(area.pocPrice).toBe(99);
    expect(area.valueAreaHigh).toBe(99);
    expect(area.valueAreaLow).toBe(98);
  });

  it("returns nulls for empty levels", () => {
    expect(computeValueArea([])).toEqual({ pocPrice: null, valueAreaHigh: null, valueAreaLow: null });
  });

  it("builds a volume profile from trade prints", () => {
    const profile = volumeProfileFromTrades(
      [
        { price: 100, size: 5, side: "buy" },
        { price: 100, size: 3, side: "sell" },
        { price: 99, size: 2, side: null },
      ],
      { tickSize: 0.25 },
    );
    expect(profile.totalVolume).toBe(10);
    expect(profile.pocPrice).toBe(100);
    expect(profile.bins.map((b) => b.price)).toEqual([99, 100]);
    expect(profile.bins[1]).toMatchObject({ buyVolume: 5, sellVolume: 3, unknownVolume: 0 });
  });
});

describe("chart studies", () => {
  const bars = [
    { time: 1, open: 10, high: 11, low: 9, close: 10, volume: 10 },
    { time: 2, open: 16, high: 21, low: 19, close: 20, volume: 30 },
  ];

  it("computes session VWAP with deviation bands", () => {
    const points = vwapFromBars(bars);
    expect(points).toHaveLength(2);
    expect(points[1].value).toBeCloseTo(17.5);
    expect(points[1].upper1).toBeGreaterThan(points[1].value);
    expect(points[1].lower2).toBeLessThan(points[1].value);
  });

  it("computes SMA and EMA with null warm-up", () => {
    expect(simpleSma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
    const ema = simpleEma([1, 2, 3, 4], 2);
    expect(ema[0]).toBeNull();
    expect(ema[1]).toBe(1.5);
    expect(ema[2]).toBeCloseTo(2.5);
  });

  it("computes Wilder RSI", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 + i);
    const series = rsi(values, 14);
    expect(series[13]).toBeNull();
    expect(series[14]).toBe(100);
    expect(rsi([100, 99, 98], 14).every((v) => v === null)).toBe(true);
  });

  it("returns Fibonacci retracement and extension prices", () => {
    const levels = fibLevels(110, 100);
    expect(levels.find((l) => l.ratio === 0)?.price).toBe(100);
    expect(levels.find((l) => l.ratio === 0.5)?.price).toBe(105);
    expect(levels.find((l) => l.ratio === 1)?.price).toBe(110);
    expect(levels.find((l) => l.ratio === 1.618)?.price).toBeCloseTo(116.18);
  });
});

describe("heatmap helpers", () => {
  const snapshot = (seconds: number, bid: number, ask: number) => ({
    eventTimestamp: at(seconds),
    bids: [{ price: bid, volume: 10 }],
    asks: [{ price: ask, volume: 12 }],
  });

  it("computes price and time ranges including trades", () => {
    expect(heatPriceRange([snapshot(0, 100, 100.25), snapshot(1, 99.75, 100)], [{ eventTimestamp: at(2), price: 101, size: 1, side: null }])).toEqual({ min: 99.75, max: 101 });
    expect(heatPriceRange([])).toBeNull();
  });

  it("scales intensity monotonically", () => {
    expect(heatIntensity(50, 100, "linear")).toBe(0.5);
    expect(heatIntensity(50, 100, "sqrt")).toBeCloseTo(Math.sqrt(0.5));
    expect(heatIntensity(50, 100, "log")).toBeGreaterThan(0);
    expect(heatIntensity(50, 100, "log")).toBeLessThan(1);
    expect(heatIntensity(0, 100)).toBe(0);
  });

  it("detects collection gaps", () => {
    const gaps = heatGaps([snapshot(0, 100, 101), snapshot(1, 100, 101), snapshot(2, 100, 101), snapshot(10, 100, 101)]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ ms: 8000 });
  });

  it("merges and dedupes snapshots and trades", () => {
    const merged = mergeSnapshots([snapshot(0, 100, 101)], [snapshot(0, 100, 101), snapshot(1, 100, 101)]);
    expect(merged).toHaveLength(2);
    expect(mergeSnapshots([snapshot(0, 100, 101)], [], 1)).toHaveLength(1);
    const trades = mergeTrades([], [
      { eventTimestamp: at(1), price: 100, size: 2, side: "buy" },
      { eventTimestamp: at(1), price: 100, size: 2, side: "buy" },
    ]);
    expect(trades).toHaveLength(1);
  });

  it("flags crossed or locked books", () => {
    expect(isCrossedBook([{ price: 100, volume: 1 }], [{ price: 100.25, volume: 1 }])).toBe(false);
    expect(isCrossedBook([{ price: 100.5, volume: 1 }], [{ price: 100.25, volume: 1 }])).toBe(true);
    expect(isCrossedBook([{ price: 100.25, volume: 1 }], [{ price: 100.25, volume: 1 }])).toBe(true);
    expect(isCrossedBook([], [{ price: 100.25, volume: 1 }])).toBe(false);
  });

  it("generates axis ticks within range", () => {
    const ticks = priceTicks(6200.1, 6203.4, 0.25, 8);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0]).toBeGreaterThanOrEqual(6200.1);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(6203.4);
  });
});

describe("bars from trades", () => {
  it("aggregates OHLCV buckets from real-style prints", () => {
    const bars = barsFromTrades(
      [
        { price: 100, size: 2, eventTimestamp: at(1) },
        { price: 101, size: 3, eventTimestamp: at(2) },
        { price: 99, size: 4, eventTimestamp: at(61) },
        { price: 100.5, size: 1, eventTimestamp: at(62) },
      ],
      60,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ open: 100, high: 101, low: 100, close: 101, volume: 5 });
    expect(bars[1]).toMatchObject({ open: 99, high: 100.5, low: 99, close: 100.5, volume: 5 });
  });
});
