import { blackScholes } from "./options";
import { DEALER_SIGN_ASSUMPTION, estimateGammaFlip, GEX_MODEL_VERSION } from "./gex";
import {
  GEX_UNIT_OPTIONS,
  gexUnitLabel,
  type GexUnit,
} from "@/lib/derivatives/gex-units";

export { GEX_UNIT_OPTIONS, gexUnitLabel, type GexUnit };

/**
 * GEX workspace aggregation — one documented convention for both the 2D
 * profiles and the 3D surface.
 *
 *  - `usd_per_1pct` : dollar gamma per 1% underlying move
 *                     gamma × OI × multiplier × spot² × 0.01
 *  - `usd_per_point`: dollar gamma per 1.00 point underlying move
 *                     gamma × OI × multiplier × spot
 *
 * Dealer positioning is unknown; the stated model assumes dealers are long call
 * gamma and short put gamma (calls positive, puts negative). Gamma is taken from
 * the provider when present, otherwise computed with Black-Scholes using the
 * chain's implied vol and calendar time to expiry.
 */

export interface GexWorkspaceContract {
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  openInterest: number;
  impliedVol?: number | null;
  gamma?: number | null;
}

export interface GexProfileInput {
  symbol: string;
  spot: number;
  contractMultiplier: number;
  expiration: string;
  asOf: string;
  contracts: GexWorkspaceContract[];
  riskFreeRate?: number;
}

export interface GexProfileRow {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  callOpenInterest: number;
  putOpenInterest: number;
}

export interface GexLevel {
  strike: number;
  gex: number;
}

export interface GexProfileStats {
  totalGex: number;
  callGex: number;
  putGex: number;
  gammaFlip: number | null;
  callResistance: GexLevel | null;
  putSupport: GexLevel | null;
  highestAbsGamma: GexLevel | null;
  hvl: number | null;
  hvlReason: string;
  computedGammaShare: number;
  contractCount: number;
  dteDays: number;
}

export interface GexProfile {
  symbol: string;
  expiration: string;
  dteDays: number;
  asOf: string;
  spot: number;
  contractMultiplier: number;
  unit: GexUnit;
  unitLabel: string;
  modelVersion: string;
  assumption: string;
  rows: GexProfileRow[];
  stats: GexProfileStats;
  warnings: string[];
}

export interface GexComparisonRow {
  strike: number;
  aCallGex: number;
  aPutGex: number;
  aNetGex: number;
  bCallGex: number;
  bPutGex: number;
  bNetGex: number;
  deltaCallGex: number;
  deltaPutGex: number;
  deltaNetGex: number;
}

export interface GexComparison {
  aLabel: string;
  bLabel: string;
  rows: GexComparisonRow[];
  topMovers: GexComparisonRow[];
  deltaTotalGex: number;
  deltaCallGex: number;
  deltaPutGex: number;
  pctChange: number | null;
  pctDenominator: number;
  pctNote: string;
}

export interface GexSurfaceExpiration {
  expiration: string;
  dteDays: number;
}

export interface GexSurfaceCell {
  expiration: string;
  strike: number;
  gex: number | null;
}

export interface GexSurface {
  symbol: string;
  spot: number;
  asOf: string;
  unit: GexUnit;
  unitLabel: string;
  modelVersion: string;
  assumption: string;
  expirations: GexSurfaceExpiration[];
  strikes: number[];
  cells: GexSurfaceCell[];
  minGex: number;
  maxGex: number;
  warnings: string[];
}

function calendarDte(expiration: string, asOf: string): number {
  const exp = Date.parse(`${expiration.slice(0, 10)}T20:00:00Z`);
  const now = Date.parse(asOf);
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((exp - now) / 86_400_000));
}

function contractGex(
  gamma: number,
  openInterest: number,
  multiplier: number,
  spot: number,
  unit: GexUnit,
): number {
  const dollarGamma = unit === "usd_per_point" ? spot : spot * spot * 0.01;
  return gamma * openInterest * multiplier * dollarGamma;
}

export function buildGexProfile(input: GexProfileInput, unit: GexUnit): GexProfile {
  const asOf = input.asOf;
  const dte = calendarDte(input.expiration, asOf);
  const rows = new Map<number, GexProfileRow>();
  const warnings: string[] = [];
  let callGex = 0;
  let putGex = 0;
  let computed = 0;
  let used = 0;
  const riskFreeRate = input.riskFreeRate ?? 0.04;
  const years = dte / 365;

  for (const c of input.contracts) {
    if (c.expiration.slice(0, 10) !== input.expiration.slice(0, 10)) continue;
    if (!(c.openInterest > 0)) continue;
    used++;

    let gamma = typeof c.gamma === "number" && Number.isFinite(c.gamma) ? c.gamma : null;
    if (gamma === null) {
      if (!(c.impliedVol && c.impliedVol > 0) || dte <= 0) {
        warnings.push(
          `${c.strike} ${c.optionType}: no provider gamma and ${dte <= 0 ? "expired contract" : "no implied vol"}; skipped`,
        );
        continue;
      }
      const g = blackScholes({
        spot: input.spot,
        strike: c.strike,
        timeToExpiry: years,
        rate: riskFreeRate,
        vol: c.impliedVol,
        type: c.optionType,
      });
      if (!g) {
        warnings.push(`${c.strike} ${c.optionType}: gamma could not be computed; skipped`);
        continue;
      }
      gamma = g.gamma;
      computed++;
    }

    const value = contractGex(gamma, c.openInterest, input.contractMultiplier, input.spot, unit);
    const row = rows.get(c.strike) ?? {
      strike: c.strike,
      callGex: 0,
      putGex: 0,
      netGex: 0,
      callOpenInterest: 0,
      putOpenInterest: 0,
    };
    if (c.optionType === "call") {
      row.callGex += value;
      row.callOpenInterest += c.openInterest;
      callGex += value;
    } else {
      row.putGex -= value;
      row.putOpenInterest += c.openInterest;
      putGex -= value;
    }
    row.netGex = row.callGex + row.putGex;
    rows.set(c.strike, row);
  }

  const perStrike = [...rows.values()].sort((a, b) => a.strike - b.strike);
  const gammaFlip = estimateGammaFlip(perStrike);
  const callResistance = bestLevel(
    perStrike.filter((r) => r.strike >= input.spot && r.callGex > 0),
    (r) => r.callGex,
    "max",
  );
  const putSupport = bestLevel(
    perStrike.filter((r) => r.strike <= input.spot && r.putGex < 0),
    (r) => r.putGex,
    "min",
  );
  const highestAbsGamma = bestLevel(
    perStrike,
    (r) => Math.abs(r.netGex),
    "max",
  );

  return {
    symbol: input.symbol,
    expiration: input.expiration,
    dteDays: dte,
    asOf,
    spot: input.spot,
    contractMultiplier: input.contractMultiplier,
    unit,
    unitLabel: gexUnitLabel(unit),
    modelVersion: GEX_MODEL_VERSION,
    assumption: DEALER_SIGN_ASSUMPTION,
    rows: perStrike,
    stats: {
      totalGex: callGex + putGex,
      callGex,
      putGex,
      gammaFlip,
      callResistance,
      putSupport,
      highestAbsGamma,
      hvl: null,
      hvlReason: "HVL requires volume-at-price data, which the options chain contract does not supply.",
      computedGammaShare: used > 0 ? computed / used : 0,
      contractCount: used,
      dteDays: dte,
    },
    warnings: warnings.slice(0, 25),
  };
}

function bestLevel(
  rows: GexProfileRow[],
  selector: (row: GexProfileRow) => number,
  mode: "min" | "max",
): GexLevel | null {
  let best: GexProfileRow | null = null;
  let bestValue = mode === "max" ? -Infinity : Infinity;
  for (const row of rows) {
    const value = selector(row);
    if (!Number.isFinite(value)) continue;
    if (mode === "max" ? value > bestValue : value < bestValue) {
      best = row;
      bestValue = value;
    }
  }
  if (!best) return null;
  return { strike: best.strike, gex: selector(best) };
}

export function buildGexComparison(a: GexProfile, b: GexProfile): GexComparison {
  const strikes = [...new Set([...a.rows, ...b.rows].map((r) => r.strike))].sort((x, y) => x - y);
  const aByStrike = new Map(a.rows.map((r) => [r.strike, r]));
  const bByStrike = new Map(b.rows.map((r) => [r.strike, r]));
  const rows = strikes.map((strike) => {
    const ar = aByStrike.get(strike);
    const br = bByStrike.get(strike);
    const aCall = ar?.callGex ?? 0;
    const aPut = ar?.putGex ?? 0;
    const bCall = br?.callGex ?? 0;
    const bPut = br?.putGex ?? 0;
    return {
      strike,
      aCallGex: aCall,
      aPutGex: aPut,
      aNetGex: aCall + aPut,
      bCallGex: bCall,
      bPutGex: bPut,
      bNetGex: bCall + bPut,
      deltaCallGex: bCall - aCall,
      deltaPutGex: bPut - aPut,
      deltaNetGex: bCall + bPut - (aCall + aPut),
    };
  });

  const deltaTotalGex = b.stats.totalGex - a.stats.totalGex;
  const denominator = a.stats.totalGex;
  return {
    aLabel: `${a.symbol} ${a.expiration}`,
    bLabel: `${b.symbol} ${b.expiration}`,
    rows,
    topMovers: [...rows].sort((x, y) => Math.abs(y.deltaNetGex) - Math.abs(x.deltaNetGex)).slice(0, 10),
    deltaTotalGex,
    deltaCallGex: b.stats.callGex - a.stats.callGex,
    deltaPutGex: b.stats.putGex - a.stats.putGex,
    pctChange: Math.abs(denominator) > 1e-9 ? (deltaTotalGex / Math.abs(denominator)) * 100 : null,
    pctDenominator: denominator,
    pctNote:
      Math.abs(denominator) > 1e-9
        ? `Percent change uses |A total GEX| as the denominator (${denominator.toFixed(0)}).`
        : "Percent change is defined only when A total GEX is non-zero; it is N/A for this comparison.",
  };
}

export interface GexSurfaceOptions {
  /** Percent around spot. 0 = all strikes. */
  strikeWindowPct?: number;
  maxStrikes?: number;
}

export function buildGexSurface(
  symbol: string,
  spot: number,
  profiles: GexProfile[],
  options: GexSurfaceOptions = {},
): GexSurface {
  const windowPct = options.strikeWindowPct ?? 0;
  const maxStrikes = options.maxStrikes ?? 80;
  const minStrike = windowPct > 0 ? spot * (1 - windowPct / 100) : -Infinity;
  const maxStrike = windowPct > 0 ? spot * (1 + windowPct / 100) : Infinity;

  let strikes = [...new Set(profiles.flatMap((p) => p.rows.map((r) => r.strike)))]
    .filter((s) => s >= minStrike && s <= maxStrike)
    .sort((a, b) => a - b);
  if (strikes.length > maxStrikes) {
    const step = Math.ceil(strikes.length / maxStrikes);
    strikes = strikes.filter((_, i) => i % step === 0 || i === strikes.length - 1);
  }

  const expirations = profiles
    .map((p) => ({ expiration: p.expiration, dteDays: p.dteDays }))
    .sort((a, b) => a.expiration.localeCompare(b.expiration));
  const profilesByExpiration = new Map(profiles.map((p) => [p.expiration, p]));
  const cells: GexSurfaceCell[] = [];

  for (const expiry of expirations) {
    const profile = profilesByExpiration.get(expiry.expiration)!;
    const byStrike = new Map(profile.rows.map((r) => [r.strike, r.netGex]));
    for (const strike of strikes) {
      cells.push({ expiration: expiry.expiration, strike, gex: byStrike.get(strike) ?? null });
    }
  }

  const values = cells.map((c) => c.gex).filter((v): v is number => v !== null && Number.isFinite(v));
  const first = profiles[0];
  return {
    symbol,
    spot,
    asOf: first?.asOf ?? new Date().toISOString(),
    unit: first?.unit ?? "usd_per_1pct",
    unitLabel: first?.unitLabel ?? gexUnitLabel("usd_per_1pct"),
    modelVersion: GEX_MODEL_VERSION,
    assumption: DEALER_SIGN_ASSUMPTION,
    expirations,
    strikes,
    cells,
    minGex: values.length > 0 ? Math.min(...values) : 0,
    maxGex: values.length > 0 ? Math.max(...values) : 0,
    warnings: [...new Set(profiles.flatMap((p) => p.warnings))].slice(0, 25),
  };
}
