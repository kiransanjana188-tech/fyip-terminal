/**
 * Gamma Exposure (GEX) model — FYIP v1.
 *
 * DOCUMENTED CONVENTIONS (do not mix conventions across visualisations):
 *  - Unit: "dollar gamma per 1% underlying move".
 *      GEX_contract = gamma * openInterest * contractMultiplier * spot^2 * 0.01
 *  - Dealer positioning is NOT observable from public data. This model applies a
 *    STATED ASSUMPTION: dealers are assumed long calls and short puts, so call
 *    gamma is signed positive and put gamma negative. This is an assumption, not
 *    a fact about any dealer's book. `assumption` is returned with every result.
 *  - Gamma is taken from the provider when supplied, otherwise computed by FYIP
 *    (see options.ts). `greeksSource` records which.
 *  - Every result carries `modelVersion` and the underlying `asOf` timestamp.
 */
import { blackScholes } from "./options";

export const GEX_MODEL_VERSION = "fyip-gex-v1";
export const DEALER_SIGN_ASSUMPTION =
  "Assumes dealers are long call gamma and short put gamma (calls +, puts -). Dealer inventory is not observable; treat as an assumption.";

export interface GexContractInput {
  strike: number;
  optionType: "call" | "put";
  openInterest: number;
  /** Provider-supplied gamma. If null/undefined, FYIP computes it from IV. */
  gamma?: number | null;
  impliedVol?: number | null;
  expiration?: string;
}

export interface GexInput {
  spot: number;
  contractMultiplier: number;
  asOf: string;
  riskFreeRate?: number;
  /** Years to expiry, used only when a contract's gamma must be computed. */
  timeToExpiryYears?: number;
  contracts: GexContractInput[];
}

export interface GexStrikeRow {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
}

export interface GexResult {
  modelVersion: string;
  asOf: string;
  spot: number;
  contractMultiplier: number;
  assumption: string;
  unit: string;
  totalGex: number;
  callGex: number;
  putGex: number;
  perStrike: GexStrikeRow[];
  /** Approximate gamma-flip level: where cumulative net GEX crosses zero. */
  gammaFlip: number | null;
  /** Fraction of contracts whose gamma FYIP had to compute. */
  computedGammaShare: number;
  warnings: string[];
}

export function computeGex(input: GexInput): GexResult {
  const warnings: string[] = [];
  const byStrike = new Map<number, GexStrikeRow>();
  let callGex = 0;
  let putGex = 0;
  let computed = 0;
  let total = 0;

  for (const c of input.contracts) {
    if (!(c.openInterest > 0)) continue;
    total++;
    let gamma = c.gamma ?? null;
    if (gamma === null || gamma === undefined) {
      const T = input.timeToExpiryYears ?? 0;
      const bs = c.impliedVol
        ? blackScholes({
            spot: input.spot,
            strike: c.strike,
            timeToExpiry: T,
            rate: input.riskFreeRate ?? 0,
            vol: c.impliedVol,
            type: c.optionType,
          })
        : null;
      if (!bs) {
        warnings.push(`strike ${c.strike} ${c.optionType}: no gamma and insufficient inputs to compute — skipped`);
        continue;
      }
      gamma = bs.gamma;
      computed++;
    }

    const gex = gamma * c.openInterest * input.contractMultiplier * input.spot * input.spot * 0.01;
    const row = byStrike.get(c.strike) ?? { strike: c.strike, callGex: 0, putGex: 0, netGex: 0 };
    if (c.optionType === "call") {
      row.callGex += gex;
      callGex += gex;
    } else {
      row.putGex -= gex; // dealer-short-put assumption -> negative
      putGex -= gex;
    }
    row.netGex = row.callGex + row.putGex;
    byStrike.set(c.strike, row);
  }

  const perStrike = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const gammaFlip = estimateGammaFlip(perStrike);

  return {
    modelVersion: GEX_MODEL_VERSION,
    asOf: input.asOf,
    spot: input.spot,
    contractMultiplier: input.contractMultiplier,
    assumption: DEALER_SIGN_ASSUMPTION,
    unit: "dollar gamma per 1% underlying move",
    totalGex: callGex + putGex,
    callGex,
    putGex,
    perStrike,
    gammaFlip,
    computedGammaShare: total > 0 ? computed / total : 0,
    warnings,
  };
}

/**
 * Estimate the gamma-flip level by finding where the cumulative signed GEX
 * (in strike order, then compared to spot) changes sign. Returns null when the
 * curve does not cross within the observed strike range.
 */
export function estimateGammaFlip(perStrike: GexStrikeRow[]): number | null {
  if (perStrike.length < 2) return null;
  let prev = perStrike[0];
  let prevCum = prev.netGex;
  for (let i = 1; i < perStrike.length; i++) {
    const cur = perStrike[i];
    const curCum = prevCum + cur.netGex;
    if ((prevCum < 0 && curCum >= 0) || (prevCum > 0 && curCum <= 0)) {
      // Linear interpolation of the crossing point between the two strikes.
      const t = Math.abs(prevCum) / (Math.abs(prevCum) + Math.abs(curCum) || 1);
      return prev.strike + t * (cur.strike - prev.strike);
    }
    prev = cur;
    prevCum = curCum;
  }
  return null;
}