/**
 * Government-bond mathematics.
 *
 * Conventions:
 *  - Annualised coupon rate and yield as decimals (0.0425 = 4.25%).
 *  - Coupons paid `frequency` times per year (2 = semi-annual, US Treasuries).
 *  - `yearsToMaturity` is a decimal number of years.
 *  - Price is the present value of all remaining cash flows (dirty price); no
 *    accrued-interest settlement convention is applied here. Where a provider
 *    supplies a clean price/yield, that value is authoritative and these
 *    functions are used only for FYIP-derived analytics.
 */

export interface BondInput {
  faceValue: number;
  couponRate: number;
  yieldRate: number;
  yearsToMaturity: number;
  frequency?: 1 | 2 | 4 | 12;
}

export function bondPrice(input: BondInput): number {
  const { faceValue, couponRate, yieldRate, yearsToMaturity } = input;
  const f = input.frequency ?? 2;
  const nPeriods = Math.max(0, Math.round(yearsToMaturity * f));
  if (nPeriods === 0) return faceValue;
  const coupon = (couponRate * faceValue) / f;
  const y = yieldRate / f;
  let price = 0;
  for (let t = 1; t <= nPeriods; t++) {
    const cf = coupon + (t === nPeriods ? faceValue : 0);
    price += cf / (1 + y) ** t;
  }
  return price;
}

/** Solve yield-to-maturity from a price via bisection. Returns null if unsolvable. */
export function yieldFromPrice(input: Omit<BondInput, "yieldRate">, price: number): number | null {
  if (!(price > 0)) return null;
  let lo = -0.5;
  let hi = 2;
  const p = (y: number) => bondPrice({ ...input, yieldRate: y });
  if (p(lo) < price || p(hi) > price) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (p(mid) > price) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Macaulay duration in years. */
export function macaulayDuration(input: BondInput): number {
  const { faceValue, couponRate, yieldRate, yearsToMaturity } = input;
  const f = input.frequency ?? 2;
  const nPeriods = Math.max(1, Math.round(yearsToMaturity * f));
  const coupon = (couponRate * faceValue) / f;
  const y = yieldRate / f;
  let weighted = 0;
  let price = 0;
  for (let t = 1; t <= nPeriods; t++) {
    const cf = coupon + (t === nPeriods ? faceValue : 0);
    const pv = cf / (1 + y) ** t;
    price += pv;
    weighted += pv * (t / f);
  }
  return price > 0 ? weighted / price : 0;
}

/** Modified duration (years). */
export function modifiedDuration(input: BondInput): number {
  const f = input.frequency ?? 2;
  return macaulayDuration(input) / (1 + input.yieldRate / f);
}

/** Convexity (years^2). */
export function convexity(input: BondInput): number {
  const { faceValue, couponRate, yieldRate, yearsToMaturity } = input;
  const f = input.frequency ?? 2;
  const nPeriods = Math.max(1, Math.round(yearsToMaturity * f));
  const coupon = (couponRate * faceValue) / f;
  const y = yieldRate / f;
  let price = 0;
  let sum = 0;
  for (let t = 1; t <= nPeriods; t++) {
    const cf = coupon + (t === nPeriods ? faceValue : 0);
    const pv = cf / (1 + y) ** t;
    price += pv;
    sum += pv * t * (t + 1);
  }
  if (price <= 0) return 0;
  return sum / (price * (1 + y) ** 2 * f * f);
}

/** DV01 — dollar value of a 1 basis point yield move (per `faceValue` notional). */
export function dv01(input: BondInput): number {
  return modifiedDuration(input) * bondPrice(input) * 0.0001;
}