/**
 * Risk & performance analytics.
 *
 * All functions document their assumptions. Modelled risk (VaR, vol) is an
 * estimate, not a guarantee, and is labelled as such in the UI.
 */

export function simpleReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) continue;
    out.push(prices[i] / prices[i - 1] - 1);
  }
  return out;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator). */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

export function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}

export function correlation(a: number[], b: number[]): number {
  const sa = stdDev(a);
  const sb = stdDev(b);
  if (sa === 0 || sb === 0) return 0;
  return covariance(a, b) / (sa * sb);
}

export interface VarResult {
  /** Positive number = loss magnitude at the confidence level. */
  var: number;
  cvar: number;
  method: "historical" | "parametric";
  confidence: number;
  observations: number;
}

/** Historical VaR/CVaR from a return series (fraction of portfolio value). */
export function historicalVar(returns: number[], confidence = 0.95): VarResult | null {
  if (returns.length < 20) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  const varAt = -sorted[Math.max(0, idx)];
  const tail = sorted.slice(0, idx + 1);
  const cvar = tail.length > 0 ? -(tail.reduce((a, b) => a + b, 0) / tail.length) : varAt;
  return { var: varAt, cvar, method: "historical", confidence, observations: returns.length };
}

/** Z-scores for common confidence levels (one-sided). */
const Z: Record<number, number> = { 0.9: 1.2816, 0.95: 1.6449, 0.99: 2.3263 };

/** Parametric (variance-covariance) VaR assuming normally-distributed returns. */
export function parametricVar(returns: number[], confidence = 0.95): VarResult | null {
  if (returns.length < 20) return null;
  const z = Z[confidence] ?? 1.6449;
  const m = mean(returns);
  const sd = stdDev(returns);
  const varAt = -(m - z * sd);
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cvar = -(m - (sd * phi) / (1 - confidence));
  return { var: varAt, cvar, method: "parametric", confidence, observations: returns.length };
}

export interface DrawdownResult {
  series: number[];
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
}

/** Drawdown series (fraction below running peak) plus max drawdown. */
export function drawdown(equity: number[]): DrawdownResult {
  let peak = equity[0] ?? 0;
  let peakIdx = 0;
  let maxDd = 0;
  let ddPeakIdx = 0;
  let ddTroughIdx = 0;
  const series: number[] = [];
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakIdx = i;
    }
    const dd = peak > 0 ? (peak - equity[i]) / peak : 0;
    series.push(-dd);
    if (dd > maxDd) {
      maxDd = dd;
      ddPeakIdx = peakIdx;
      ddTroughIdx = i;
    }
  }
  return { series, maxDrawdown: maxDd, peakIndex: ddPeakIdx, troughIndex: ddTroughIdx };
}

/** Annualised Sharpe ratio from a return series. */
export function sharpe(returns: number[], riskFreeAnnual = 0, periodsPerYear = 252): number | null {
  if (returns.length < 2) return null;
  const sd = stdDev(returns);
  if (sd === 0) return null;
  const excess = mean(returns) - riskFreeAnnual / periodsPerYear;
  return (excess / sd) * Math.sqrt(periodsPerYear);
}

/** Annualised Sortino ratio (downside deviation denominator). */
export function sortino(returns: number[], targetAnnual = 0, periodsPerYear = 252): number | null {
  if (returns.length < 2) return null;
  const target = targetAnnual / periodsPerYear;
  const downside = returns.filter((r) => r < target);
  if (downside.length === 0) return null;
  const dd = Math.sqrt(downside.reduce((a, b) => a + (b - target) ** 2, 0) / returns.length);
  if (dd === 0) return null;
  return ((mean(returns) - target) / dd) * Math.sqrt(periodsPerYear);
}

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
}

/** Trade-level statistics from a list of per-trade P&L values. */
export function tradeStats(pnls: number[]): TradeStats {
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const trades = pnls.length;
  const winRate = trades > 0 ? wins.length / trades : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  return {
    trades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: trades > 0 ? pnls.reduce((a, b) => a + b, 0) / trades : 0,
    avgWin,
    avgLoss,
  };
}