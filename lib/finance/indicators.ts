/**
 * Technical indicators. Pure functions over numeric series so they are unit
 * testable and never confused with vendor data. Outputs align index-for-index
 * with the input; warm-up positions are `null`.
 */

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      seed += values[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
      continue;
    }
    prev = values[i] * k + (prev as number) * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const compact = macdLine.filter((v): v is number => v !== null);
  const signalCompact = ema(compact, signalPeriod);
  const signal: (number | null)[] = Array(values.length).fill(null);
  let ci = 0;
  for (let i = 0; i < values.length; i++) {
    if (macdLine[i] !== null) {
      signal[i] = signalCompact[ci] ?? null;
      ci++;
    }
  }
  const histogram = values.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null ? (macdLine[i] as number) - (signal[i] as number) : null,
  );
  return { macd: macdLine, signal, histogram };
}

/** Average True Range (Wilder). */
export function atr(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const n = closes.length;
  const out: (number | null)[] = Array(n).fill(null);
  if (n < period + 1) return out;
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr.push(highs[i] - lows[i]);
      continue;
    }
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: (number | null)[] = Array(values.length).fill(null);
  const lower: (number | null)[] = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i];
    if (m === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { middle, upper, lower };
}

/**
 * Session VWAP using typical price ((H+L+C)/3) and volume. Optionally anchored
 * at a start index, and with configurable standard-deviation bands.
 */
export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  startIndex = 0,
): { vwap: (number | null)[]; upper1: (number | null)[]; lower1: (number | null)[] } {
  const n = closes.length;
  const out: (number | null)[] = Array(n).fill(null);
  const upper1: (number | null)[] = Array(n).fill(null);
  const lower1: (number | null)[] = Array(n).fill(null);
  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  for (let i = 0; i < n; i++) {
    if (i < startIndex) continue;
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += tp * volumes[i];
    cumPV2 += tp * tp * volumes[i];
    cumV += volumes[i];
    if (cumV > 0) {
      const vw = cumPV / cumV;
      const variance = Math.max(0, cumPV2 / cumV - vw * vw);
      const sd = Math.sqrt(variance);
      out[i] = vw;
      upper1[i] = vw + sd;
      lower1[i] = vw - sd;
    }
  }
  return { vwap: out, upper1, lower1 };
}

/** Annualised realised volatility from close-to-close log returns. */
export function realizedVol(closes: number[], window: number, periodsPerYear = 252): number | null {
  if (closes.length < window + 1) return null;
  const rets: number[] = [];
  for (let i = closes.length - window; i < closes.length; i++) {
    if (closes[i - 1] <= 0 || closes[i] <= 0) continue;
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

/** Relative volume = current volume / average volume over the prior `period` bars. */
export function relativeVolume(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const current = volumes[volumes.length - 1];
  const prior = volumes.slice(volumes.length - 1 - period, volumes.length - 1);
  const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (avg <= 0) return null;
  return current / avg;
}