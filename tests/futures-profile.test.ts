import { describe, expect, it } from "vitest";
import {
  aggregateProfileRows,
  aggregateSurfaceRows,
  assembleProfile,
  assembleSurface,
  bucketLabel,
  bucketMinute,
  computeVwap,
  type CellAggregateRow,
  type MinuteCellRow,
  type PriceAggregateRow,
} from "../lib/analytics/futures-profile";

describe("assembleProfile", () => {
  const rows: PriceAggregateRow[] = [
    { key: 10, volume: 100, buy: 70, sell: 20, unknown: 10 },
    { key: 11, volume: 300, buy: 100, sell: 150, unknown: 50 },
    { key: 12, volume: 50, buy: 10, sell: 40, unknown: 0 },
  ];

  it("bins ascending prices at key × step", () => {
    const profile = assembleProfile(rows, 0.5);
    expect(profile.rowStep).toBe(0.5);
    expect(profile.bins.map((bin) => bin.price)).toEqual([5, 5.5, 6]);
  });

  it("totals volume, buy/sell sides and delta", () => {
    const profile = assembleProfile(rows, 0.5);
    expect(profile.totalVolume).toBe(450);
    expect(profile.buyVolume).toBe(180);
    expect(profile.sellVolume).toBe(210);
    expect(profile.unknownVolume).toBe(60);
    expect(profile.delta).toBe(-30);
  });

  it("identifies POC and the 70% value area", () => {
    const profile = assembleProfile(rows, 0.5);
    expect(profile.pocPrice).toBe(5.5);
    expect(profile.valueAreaLow).toBe(5);
    expect(profile.valueAreaHigh).toBe(5.5);
  });

  it("returns null levels for empty input", () => {
    const profile = assembleProfile([], 0.25);
    expect(profile.bins).toEqual([]);
    expect(profile.pocPrice).toBeNull();
    expect(profile.valueAreaHigh).toBeNull();
    expect(profile.valueAreaLow).toBeNull();
  });

  it("ignores non-finite aggregate rows", () => {
    const profile = assembleProfile(
      [{ key: Number.NaN, volume: 10, buy: 5, sell: 5, unknown: 0 }, ...rows],
      0.5,
    );
    expect(profile.bins).toHaveLength(3);
  });
});

describe("computeVwap", () => {
  it("divides price-volume by volume", () => {
    expect(computeVwap(4500, 450)).toBe(10);
  });

  it("rejects missing or zero volume", () => {
    expect(computeVwap(null, 10)).toBeNull();
    expect(computeVwap(100, null)).toBeNull();
    expect(computeVwap(100, 0)).toBeNull();
    expect(computeVwap(Number.NaN, 10)).toBeNull();
  });
});

describe("assembleSurface", () => {
  const cells: CellAggregateRow[] = [
    { bucket: "2026-10-20T13:00", key: 10, volume: 60, buy: 40, sell: 20 },
    { bucket: "2026-10-20T13:00", key: 11, volume: 90, buy: 30, sell: 60 },
  ];
  const buckets = [{ key: "2026-10-20T13:00", label: "13:00" }];

  it("derives price ladder, deltas and maxima", () => {
    const surface = assembleSurface(cells, buckets, 10, 11, 0.5, 15);
    expect(surface.prices).toEqual([5, 5.5]);
    expect(surface.cells).toHaveLength(2);
    expect(surface.cells[0]).toMatchObject({ price: 5, volume: 60, delta: 20 });
    expect(surface.cells[1]).toMatchObject({ price: 5.5, volume: 90, delta: -30 });
    expect(surface.maxVolume).toBe(90);
    expect(surface.maxAbsDelta).toBe(30);
    expect(surface.bucketMinutes).toBe(15);
  });

  it("handles an empty cell set", () => {
    const surface = assembleSurface([], buckets, 10, 10, 0.25, 5);
    expect(surface.cells).toEqual([]);
    expect(surface.maxVolume).toBe(0);
    expect(surface.prices).toEqual([2.5]);
  });
});

describe("bucketLabel", () => {
  it("formats the time portion of a bucket key", () => {
    expect(bucketLabel("2026-10-20T13:15")).toBe("13:15");
    expect(bucketLabel("13:15")).toBe("13:15");
  });
});

const minuteRows: MinuteCellRow[] = [
  { minute: "2026-10-20T13:00", key: 10, volume: 30, buy: 20, sell: 10, prints: 5, priceVolume: 50 * 30 },
  { minute: "2026-10-20T13:01", key: 10, volume: 20, buy: 10, sell: 10, prints: 3, priceVolume: 50 * 20 },
  { minute: "2026-10-20T13:07", key: 11, volume: 40, buy: 15, sell: 25, prints: 6, priceVolume: 55 * 40 },
  { minute: "2026-10-20T13:16", key: 11, volume: 10, buy: 9, sell: 1, prints: 2, priceVolume: 55 * 10 },
];

describe("aggregateProfileRows", () => {
  it("sums per-minute rows into price aggregates", () => {
    const rows = aggregateProfileRows(minuteRows);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: 10, volume: 50, buy: 30, sell: 20, unknown: 0 });
    expect(rows[1]).toMatchObject({ key: 11, volume: 50, buy: 24, sell: 26, unknown: 0 });
  });
});

describe("bucketMinute", () => {
  it("floors minutes into the requested bucket width", () => {
    expect(bucketMinute("2026-10-20T17:07", 15)).toEqual({ key: "2026-10-20T17:00", label: "17:00" });
    expect(bucketMinute("2026-10-20T17:59", 15)).toEqual({ key: "2026-10-20T17:45", label: "17:45" });
    expect(bucketMinute("2026-10-20T17:59", 5)).toEqual({ key: "2026-10-20T17:55", label: "17:55" });
  });
});

describe("aggregateSurfaceRows", () => {
  it("groups minute rows into time buckets and coarse price keys", () => {
    const { cells, buckets, minKey, maxKey } = aggregateSurfaceRows(minuteRows, 15, 2);
    expect(buckets.map((b) => b.label)).toEqual(["13:00", "13:15"]);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatchObject({ bucket: "2026-10-20T13:00", key: 5, volume: 50, buy: 30, sell: 20 });
    expect(minKey).toBe(5);
    expect(maxKey).toBe(6);
  });
});
