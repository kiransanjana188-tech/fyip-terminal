import { afterEach, describe, expect, it } from "vitest";
import {
  buildGexComparison,
  buildGexProfile,
  buildGexSurface,
  type GexProfileInput,
} from "../lib/finance/gex-workspace";
import { FixtureOptionsProvider } from "../lib/providers/options-fixtures";
import { OPTIONS_SYMBOLS } from "../lib/market/options";

const BASE = {
  symbol: "SPY",
  spot: 100,
  contractMultiplier: 100,
  expiration: "2027-01-15",
  asOf: "2026-10-20T00:00:00Z",
  riskFreeRate: 0.04,
};

function profile(overrides: Partial<GexProfileInput> = {}) {
  return buildGexProfile({
    ...BASE,
    contracts: [
      { expiration: BASE.expiration, strike: 100, optionType: "call", openInterest: 100, gamma: 0.02 },
      { expiration: BASE.expiration, strike: 100, optionType: "put", openInterest: 100, gamma: 0.02 },
    ],
    ...overrides,
  }, "usd_per_1pct");
}

describe("GEX workspace units and aggregation", () => {
  it("uses dollar gamma per 1% and per point with the documented formulas", () => {
    const perPct = profile({ spot: 200, contracts: [
      { expiration: BASE.expiration, strike: 200, optionType: "call", openInterest: 100, gamma: 0.02 },
    ] });
    const perPoint = buildGexProfile({
      ...BASE,
      spot: 200,
      contracts: [
        { expiration: BASE.expiration, strike: 200, optionType: "call", openInterest: 100, gamma: 0.02 },
      ],
    }, "usd_per_point");

    expect(perPct.rows[0].callGex).toBeCloseTo(0.02 * 100 * 100 * 200 * 200 * 0.01, 6);
    expect(perPoint.rows[0].callGex).toBeCloseTo(0.02 * 100 * 100 * 200, 6);
    expect(perPct.rows[0].callGex).toBeCloseTo(perPoint.rows[0].callGex * 2, 6);
  });

  it("applies the dealer-sign assumption and only uses the requested expiration", () => {
    const result = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 100, optionType: "call", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 100, optionType: "put", openInterest: 100, gamma: 0.02 },
        { expiration: "2026-12-18", strike: 100, optionType: "call", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 105, optionType: "call", openInterest: 0, gamma: 0.02 },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.stats.callGex).toBeGreaterThan(0);
    expect(result.stats.putGex).toBeLessThan(0);
    expect(result.stats.totalGex).toBeCloseTo(0, 6);
    expect(result.stats.contractCount).toBe(2);
  });

  it("computes a gamma flip only when the cumulative curve actually crosses", () => {
    const crossing = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 90, optionType: "call", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 90, optionType: "put", openInterest: 1000, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 110, optionType: "call", openInterest: 2000, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 110, optionType: "put", openInterest: 100, gamma: 0.02 },
      ],
    });
    expect(crossing.stats.gammaFlip).not.toBeNull();
    expect(crossing.stats.gammaFlip!).toBeGreaterThan(90);
    expect(crossing.stats.gammaFlip!).toBeLessThan(110);

    const sameSign = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 90, optionType: "call", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 110, optionType: "call", openInterest: 100, gamma: 0.02 },
      ],
    });
    expect(sameSign.stats.gammaFlip).toBeNull();
  });

  it("estimates call resistance above spot and put support below spot", () => {
    const result = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 95, optionType: "put", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 95, optionType: "call", openInterest: 20, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 105, optionType: "call", openInterest: 500, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 105, optionType: "put", openInterest: 20, gamma: 0.02 },
      ],
    });
    expect(result.stats.callResistance?.strike).toBe(105);
    expect(result.stats.putSupport?.strike).toBe(95);
    expect(result.stats.hvl).toBeNull();
  });

  it("marks computed gamma share when the provider does not supply gamma", () => {
    const result = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 100, optionType: "call", openInterest: 100, impliedVol: 0.2 },
        { expiration: BASE.expiration, strike: 105, optionType: "call", openInterest: 100, gamma: 0.015 },
      ],
    });
    expect(result.stats.computedGammaShare).toBeCloseTo(0.5, 6);
  });
});

describe("GEX comparison and surface", () => {
  it("defines percentage change only when the A denominator is non-zero", () => {
    const zero = profile();
    const nonZero = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 100, optionType: "call", openInterest: 300, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 100, optionType: "put", openInterest: 100, gamma: 0.02 },
      ],
    });
    expect(buildGexComparison(zero, nonZero).pctChange).toBeNull();
    const cmp = buildGexComparison(nonZero, zero);
    expect(cmp.pctChange).not.toBeNull();
    expect(cmp.pctDenominator).toBe(nonZero.stats.totalGex);
  });

  it("aligns strikes and computes delta net GEX", () => {
    const a = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 100, optionType: "call", openInterest: 100, gamma: 0.02 },
      ],
    });
    const b = buildGexProfile({
      ...BASE,
      expiration: "2027-02-19",
      contracts: [
        { expiration: "2027-02-19", strike: 100, optionType: "call", openInterest: 300, gamma: 0.02 },
        { expiration: "2027-02-19", strike: 105, optionType: "call", openInterest: 100, gamma: 0.02 },
      ],
    }, "usd_per_1pct");
    const cmp = buildGexComparison(a, b);
    const row100 = cmp.rows.find((r) => r.strike === 100)!;
    expect(row100.deltaNetGex).toBeCloseTo(b.rows[0].netGex - a.rows[0].netGex, 6);
    expect(cmp.rows.find((r) => r.strike === 105)?.aNetGex).toBe(0);
  });

  it("builds a surface grid with nulls for unobserved cells and applies the window", () => {
    const near = profile({
      contracts: [
        { expiration: BASE.expiration, strike: 90, optionType: "call", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 100, optionType: "call", openInterest: 100, gamma: 0.02 },
        { expiration: BASE.expiration, strike: 130, optionType: "call", openInterest: 100, gamma: 0.02 },
      ],
    });
    const far = buildGexProfile({
      ...BASE,
      spot: 100,
      expiration: "2027-02-19",
      contracts: [
        { expiration: "2027-02-19", strike: 100, optionType: "call", openInterest: 50, gamma: 0.01 },
        { expiration: "2027-02-19", strike: 110, optionType: "call", openInterest: 50, gamma: 0.01 },
      ],
    }, "usd_per_1pct");
    const surface = buildGexSurface("SPY", 100, [near, far], { strikeWindowPct: 10 });
    expect(surface.strikes).toEqual([90, 100, 110]);
    expect(surface.expirations).toHaveLength(2);
    expect(surface.cells).toHaveLength(6);
    expect(surface.cells.find((c) => c.expiration === far.expiration && c.strike === 90)?.gex).toBeNull();
    expect(surface.cells.find((c) => c.strike === 110 && c.expiration === far.expiration)?.gex).not.toBeNull();
  });
});

describe("options fixtures", () => {
  const previous = process.env.FYIP_ENABLE_FIXTURES;
  afterEach(() => {
    if (previous === undefined) delete process.env.FYIP_ENABLE_FIXTURES;
    else process.env.FYIP_ENABLE_FIXTURES = previous;
  });

  it("is disabled unless FYIP_ENABLE_FIXTURES=true", () => {
    delete process.env.FYIP_ENABLE_FIXTURES;
    const provider = new FixtureOptionsProvider();
    expect(provider.isConfigured()).toBe(false);
    process.env.FYIP_ENABLE_FIXTURES = "true";
    expect(provider.isConfigured()).toBe(true);
  });

  it("returns labelled synthetic chains for every supported symbol", async () => {
    process.env.FYIP_ENABLE_FIXTURES = "true";
    const provider = new FixtureOptionsProvider();
    for (const cfg of OPTIONS_SYMBOLS) {
      const chain = await provider.fetchChain(`inst_${cfg.symbol.toLowerCase()}`);
      expect(chain.length).toBeGreaterThan(100);
      expect(chain.every((c) => c.openInterest !== null && c.openInterest! > 0)).toBe(true);
      expect(chain.every((c) => c.underlyingPrice === chain[0].underlyingPrice)).toBe(true);
      expect(new Set(chain.map((c) => c.expiration)).size).toBeGreaterThanOrEqual(2);
    }
    expect(OPTIONS_SYMBOLS.find((s) => s.symbol === "SPY")?.contractMultiplier).toBe(100);
    expect(OPTIONS_SYMBOLS.find((s) => s.symbol === "ES")?.contractMultiplier).toBe(50);
    expect(OPTIONS_SYMBOLS.find((s) => s.symbol === "NQ")?.contractMultiplier).toBe(20);
  });
});
