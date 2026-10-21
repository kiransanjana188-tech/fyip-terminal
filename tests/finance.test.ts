import { describe, it, expect } from "vitest";
import { blackScholes, impliedVolatility, intrinsicValue, normCdf } from "../lib/finance/options";
import { computeGex, estimateGammaFlip, GEX_MODEL_VERSION } from "../lib/finance/gex";
import { sma, ema, rsi, macd, atr, bollinger, vwap, realizedVol } from "../lib/finance/indicators";
import { bondPrice, yieldFromPrice, modifiedDuration, convexity, dv01 } from "../lib/finance/bonds";
import { drawdown, sharpe, historicalVar, parametricVar, tradeStats, correlation } from "../lib/finance/risk";

describe("options / Black-Scholes", () => {
  it("prices a known ATM call to the reference value", () => {
    const g = blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, rate: 0.05, vol: 0.2, type: "call" });
    expect(g).not.toBeNull();
    expect(g!.price).toBeCloseTo(10.4506, 1);
    expect(g!.delta).toBeCloseTo(0.6368, 2);
  });

  it("put-call parity holds", () => {
    const c = blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, rate: 0.05, vol: 0.2, type: "call" })!;
    const p = blackScholes({ spot: 100, strike: 100, timeToExpiry: 1, rate: 0.05, vol: 0.2, type: "put" })!;
    const parity = c.price - p.price - (100 - 100 * Math.exp(-0.05));
    expect(Math.abs(parity)).toBeLessThan(1e-6);
  });

  it("returns null for degenerate inputs instead of fabricating a value", () => {
    expect(blackScholes({ spot: 0, strike: 100, timeToExpiry: 1, rate: 0.05, vol: 0.2, type: "call" })).toBeNull();
    expect(blackScholes({ spot: 100, strike: 100, timeToExpiry: 0, rate: 0.05, vol: 0.2, type: "call" })).toBeNull();
  });

  it("recovers implied volatility from a price", () => {
    const priced = blackScholes({ spot: 100, strike: 105, timeToExpiry: 0.5, rate: 0.03, vol: 0.25, type: "call" })!;
    const iv = impliedVolatility(priced.price, { spot: 100, strike: 105, timeToExpiry: 0.5, rate: 0.03, type: "call" });
    expect(iv).toBeCloseTo(0.25, 3);
  });

  it("normCdf is monotone and correct at 0", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it("computes intrinsic value", () => {
    expect(intrinsicValue(110, 100, "call")).toBe(10);
    expect(intrinsicValue(110, 100, "put")).toBe(0);
  });
});

describe("GEX model", () => {
  const base = {
    spot: 100,
    contractMultiplier: 100,
    asOf: "2026-01-01T00:00:00Z",
    timeToExpiryYears: 0.05,
    riskFreeRate: 0.04,
  };

  it("aggregates call and put exposure per strike with the documented sign assumption", () => {
    const res = computeGex({
      ...base,
      contracts: [
        { strike: 100, optionType: "call", openInterest: 1000, impliedVol: 0.2 },
        { strike: 100, optionType: "put", openInterest: 1000, impliedVol: 0.2 },
      ],
    });
    expect(res.modelVersion).toBe(GEX_MODEL_VERSION);
    expect(res.perStrike).toHaveLength(1);
    expect(res.callGex).toBeGreaterThan(0);
    expect(res.putGex).toBeLessThan(0); // dealer-short-put assumption
    expect(res.assumption).toMatch(/assum/i);
  });

  it("uses provider gamma when supplied and reports computed share", () => {
    const res = computeGex({
      ...base,
      contracts: [
        { strike: 100, optionType: "call", openInterest: 100, gamma: 0.02 },
        { strike: 105, optionType: "call", openInterest: 100, impliedVol: 0.2 },
      ],
    });
    expect(res.computedGammaShare).toBeCloseTo(0.5, 5);
  });

  it("estimates a gamma flip between strikes when the cumulative curve crosses zero", () => {
    const flip = estimateGammaFlip([
      { strike: 90, callGex: -100, putGex: 0, netGex: -100 },
      { strike: 110, callGex: 200, putGex: 0, netGex: 200 },
    ]);
    expect(flip).not.toBeNull();
    expect(flip!).toBeGreaterThan(90);
    expect(flip!).toBeLessThan(110);
  });
});

describe("indicators", () => {
  it("computes SMA with warm-up nulls", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("computes EMA seeding with the SMA of the first window", () => {
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[0]).toBeNull();
    expect(e[1]).toBeNull();
    expect(e[2]).toBeCloseTo(2, 6);
  });

  it("RSI is 100 for a strictly rising series", () => {
    const r = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    expect(r[r.length - 1]).toBeCloseTo(100, 5);
  });

  it("MACD histogram equals macd - signal", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5);
    const m = macd(values);
    const i = values.length - 1;
    expect(m.histogram[i]).toBeCloseTo((m.macd[i] as number) - (m.signal[i] as number), 6);
  });

  it("ATR returns positive values after warm-up", () => {
    const n = 40;
    const highs = Array.from({ length: n }, (_, i) => 10 + i * 0.1 + 0.5);
    const lows = Array.from({ length: n }, (_, i) => 10 + i * 0.1 - 0.5);
    const closes = Array.from({ length: n }, (_, i) => 10 + i * 0.1);
    const a = atr(highs, lows, closes, 14);
    expect(a[n - 1]).toBeGreaterThan(0);
  });

  it("Bollinger upper > middle > lower", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + (i % 5));
    const b = bollinger(values, 20, 2);
    const i = values.length - 1;
    expect(b.upper[i]!).toBeGreaterThan(b.middle[i]!);
    expect(b.lower[i]!).toBeLessThan(b.middle[i]!);
  });

  it("VWAP is volume-weighted on the typical price", () => {
    // typical price bar0 = 10, bar1 = (10+10+20)/3 = 40/3
    const v = vwap([10, 10], [10, 10], [10, 20], [1, 3]);
    expect(v.vwap[1]).toBeCloseTo((10 * 1 + (40 / 3) * 3) / 4, 6);
  });

  it("realizedVol returns null without enough data", () => {
    expect(realizedVol([1, 2, 3], 10)).toBeNull();
  });
});

describe("bonds", () => {
  it("prices a bond at par when coupon equals yield", () => {
    const price = bondPrice({ faceValue: 1000, couponRate: 0.05, yieldRate: 0.05, yearsToMaturity: 5, frequency: 2 });
    expect(price).toBeCloseTo(1000, 6);
  });

  it("prices a zero-coupon bond by discounting", () => {
    const price = bondPrice({ faceValue: 1000, couponRate: 0, yieldRate: 0.05, yearsToMaturity: 10, frequency: 2 });
    expect(price).toBeCloseTo(1000 / Math.pow(1.025, 20), 6);
  });

  it("round-trips yield from price", () => {
    const y = yieldFromPrice({ faceValue: 1000, couponRate: 0.04, yearsToMaturity: 7, frequency: 2 }, 950);
    expect(y).not.toBeNull();
    const back = bondPrice({ faceValue: 1000, couponRate: 0.04, yieldRate: y!, yearsToMaturity: 7, frequency: 2 });
    expect(back).toBeCloseTo(950, 4);
  });

  it("duration, convexity and DV01 are positive", () => {
    const input = { faceValue: 1000, couponRate: 0.05, yieldRate: 0.04, yearsToMaturity: 10, frequency: 2 as const };
    expect(modifiedDuration(input)).toBeGreaterThan(0);
    expect(convexity(input)).toBeGreaterThan(0);
    expect(dv01(input)).toBeGreaterThan(0);
  });
});

describe("risk", () => {
  it("computes max drawdown", () => {
    const dd = drawdown([100, 120, 90, 110]);
    expect(dd.maxDrawdown).toBeCloseTo(0.25, 6);
  });

  it("trade stats profit factor and win rate", () => {
    const s = tradeStats([10, -5, 20, -5]);
    expect(s.winRate).toBeCloseTo(0.5, 6);
    expect(s.profitFactor).toBeCloseTo(30 / 10, 6);
  });

  it("returns null VaR with too few observations", () => {
    expect(historicalVar([0.01, -0.02])).toBeNull();
    expect(parametricVar([0.01, -0.02])).toBeNull();
  });

  it("VaR is positive for a loss-bearing series", () => {
    const rets = Array.from({ length: 100 }, (_, i) => (i % 7 === 0 ? -0.03 : 0.002));
    const v = historicalVar(rets, 0.95)!;
    expect(v.var).toBeGreaterThan(0);
    expect(v.cvar).toBeGreaterThanOrEqual(v.var);
  });

  it("correlation of a series with itself is 1", () => {
    const a = [1, 2, 3, 4, 5, 6];
    expect(correlation(a, a)).toBeCloseTo(1, 6);
  });

  it("sharpe returns null for zero variance", () => {
    expect(sharpe([0.01, 0.01, 0.01])).toBeNull();
  });
});