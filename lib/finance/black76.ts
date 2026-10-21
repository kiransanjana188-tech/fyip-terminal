/**
 * Black-76 pricing for options on futures.
 *
 * CME futures-options premiums are quoted against the futures price, not the
 * index spot, so the GEX pipeline uses the Black-76 model with r = 0:
 *
 *   call    = F * N(d1) - K * N(d2)
 *   put     = K * N(-d2) - F * N(-d1)
 *   d1      = (ln(F/K) + 0.5 * sigma^2 * T) / (sigma * sqrt(T))
 *   d2      = d1 - sigma * sqrt(T)
 *   gamma   = N'(d1) / (F * sigma * sqrt(T))   (d gamma / dF)
 *
 * Conventions match lib/finance/options.ts:
 *  - T in years (calendar days / 365)
 *  - vol annualised decimal (0.20 = 20%)
 *  - results are FYIP-calculated estimates, never provider-supplied values
 */
import type { OptionType } from "./options";
import { normCdf, normPdf } from "./options";

export interface Black76Result {
  price: number;
  /** d(delta)/dF — the gamma used in GEX (dealer-long-shares sign handled upstream). */
  gamma: number;
  /** d(price)/dF for a dealer; also the standard futures-option delta. */
  delta: number;
}

export function black76(input: {
  forward: number;
  strike: number;
  timeToExpiry: number;
  vol: number;
  type: OptionType;
}): Black76Result | null {
  const { forward: F, strike: K, timeToExpiry: T, vol, type } = input;
  if (!(F > 0) || !(K > 0) || !(vol > 0) || !(T > 0)) return null;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * vol * vol * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;

  const gamma = normPdf(d1) / (F * vol * sqrtT);
  if (type === "call") {
    const price = F * normCdf(d1) - K * normCdf(d2);
    const delta = normCdf(d1);
    return { price, gamma, delta };
  }
  const price = K * normCdf(-d2) - F * normCdf(-d1);
  const delta = -normCdf(-d1);
  return { price, gamma, delta };
}

/**
 * Futures-option gamma at a given vol. Used when the chain carries OI and a
 * quoted price (so FYIP solves IV first) or an already-known IV.
 */
export function black76Gamma(input: {
  forward: number;
  strike: number;
  timeToExpiry: number;
  vol: number;
}): number | null {
  const r = black76({ ...input, type: "call" });
  return r?.gamma ?? null;
}

/**
 * Implied volatility via bisection on the Black-76 price. A futures-option
 * premium must sit between intrinsic value and F (call) / K (put); anything
 * outside that band returns null rather than an extrapolated number.
 */
export function black76ImpliedVol(
  marketPrice: number,
  input: { forward: number; strike: number; timeToExpiry: number; type: OptionType },
  opts: { lo?: number; hi?: number; tol?: number; maxIter?: number } = {},
): number | null {
  const { forward: F, strike: K, timeToExpiry: T, type } = input;
  if (!(F > 0) || !(K > 0) || !(T > 0) || !(marketPrice > 0)) return null;

  const intrinsic =
    type === "call" ? Math.max(0, F - K) : Math.max(0, K - F);
  const upperBound = type === "call" ? F : K;
  if (marketPrice < intrinsic - 1e-9 || marketPrice > upperBound) return null;
  if (marketPrice <= Math.max(intrinsic, 0) + 1e-9) return null; // no time value to solve

  let lo = opts.lo ?? 0.0001;
  let hi = opts.hi ?? 5;
  const tol = opts.tol ?? 1e-6;
  const maxIter = opts.maxIter ?? 100;

  const price = (v: number) => black76({ forward: F, strike: K, timeToExpiry: T, vol: v, type })?.price ?? 0;
  if (price(lo) > marketPrice || price(hi) < marketPrice) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const pm = price(mid);
    if (Math.abs(pm - marketPrice) < tol) return mid;
    if (pm < marketPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
