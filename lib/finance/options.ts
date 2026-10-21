/**
 * Options analytics — Black-Scholes-Merton pricing and Greeks.
 *
 * Conventions (documented and enforced across the codebase):
 *  - `timeToExpiry` (T) is in YEARS (calendar days / 365).
 *  - `rate` and `dividendYield` are continuously-compounded annual decimals (0.05 = 5%).
 *  - `vol` is annualised decimal (0.20 = 20%).
 *  - Vega is per 1.00 change in vol (divide by 100 for "per vol point" display).
 *  - Theta is per YEAR; callers usually divide by 365 for per-day.
 *  - Gamma is d(delta)/dS.
 * Results are FYIP-calculated estimates, never provider-supplied values.
 */

export type OptionType = "call" | "put";

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-0.5 * x * x);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export interface BsInput {
  spot: number;
  strike: number;
  timeToExpiry: number;
  rate: number;
  vol: number;
  type: OptionType;
  dividendYield?: number;
}

/**
 * Black-Scholes-Merton price + Greeks. Returns null for degenerate inputs
 * (non-positive spot/strike/vol, or past expiry) so callers never display a
 * fabricated number.
 */
export function blackScholes(input: BsInput): Greeks | null {
  const { spot, strike, timeToExpiry: T, rate: r, vol, type } = input;
  const q = input.dividendYield ?? 0;
  if (!(spot > 0) || !(strike > 0) || !(vol > 0) || !(T > 0)) return null;

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (r - q + 0.5 * vol * vol) * T) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;

  const discR = Math.exp(-r * T);
  const discQ = Math.exp(-q * T);

  const nd1 = normCdf(d1);
  const nd2 = normCdf(d2);
  const npd1 = normPdf(d1);

  let price: number;
  let delta: number;
  let rho: number;

  if (type === "call") {
    price = spot * discQ * nd1 - strike * discR * nd2;
    delta = discQ * nd1;
    rho = (strike * T * discR * nd2) / 100;
  } else {
    price = strike * discR * normCdf(-d2) - spot * discQ * normCdf(-d1);
    delta = -discQ * normCdf(-d1);
    rho = (-strike * T * discR * normCdf(-d2)) / 100;
  }

  const gamma = (discQ * npd1) / (spot * vol * sqrtT);
  const vega = (spot * discQ * npd1 * sqrtT) / 100;

  let theta: number;
  const term1 = -(spot * discQ * npd1 * vol) / (2 * sqrtT);
  if (type === "call") {
    theta = term1 - r * strike * discR * nd2 + q * spot * discQ * nd1;
  } else {
    theta = term1 + r * strike * discR * normCdf(-d2) - q * spot * discQ * normCdf(-d1);
  }
  theta = theta / 365; // per calendar day

  return { price, delta, gamma, theta, vega, rho };
}

/** Intrinsic value (no time value). */
export function intrinsicValue(spot: number, strike: number, type: OptionType): number {
  return type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
}

/**
 * Implied volatility via bisection on the BSM price function. Returns null when
 * the market price is outside the no-arbitrage band or does not converge.
 */
export function impliedVolatility(
  marketPrice: number,
  input: Omit<BsInput, "vol">,
  opts: { lo?: number; hi?: number; tol?: number; maxIter?: number } = {},
): number | null {
  let lo = opts.lo ?? 0.0001;
  let hi = opts.hi ?? 5;
  const tol = opts.tol ?? 1e-6;
  const maxIter = opts.maxIter ?? 100;

  const intrinsic = intrinsicValue(input.spot, input.strike, input.type) * Math.exp(-(input.dividendYield ?? 0) * input.timeToExpiry);
  if (marketPrice < intrinsic - 1e-9) return null;

  const price = (v: number) => blackScholes({ ...input, vol: v })?.price ?? 0;
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