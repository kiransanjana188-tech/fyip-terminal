import { queryOne } from "@/lib/db";
import type { InstrumentRow } from "@/lib/market/instruments";
import type { NormalizedQuote } from "@/lib/providers/types";

/**
 * NinjaTrader bridge futures-option instrument-id grammar.
 *
 * `opt_<contractCode>_<c|p><strike>` with an all-lowercase CME contract code,
 * e.g. `opt_esz6_c6800` = ES December-2026 quarterly option, 6800 call.
 * The contract-year digit is the last digit of the contract year (2026 → 6),
 * the same rule the instrument master uses for quarterly contract symbols.
 * Strikes are expressed as plain digits; the supported roots use integer
 * strike steps (ES 25, NQ 10, RTY 5, YM 5), so no fractional encoding is
 * needed. Malformed ids are rejected — nothing is fabricated from them.
 */
const OPTION_ID_RE = /^opt_([a-z]{1,4}?)([fghjkmnquvxz])(\d)_([cp])(\d{1,7})$/;

export interface ParsedOptionId {
  /** Full CME contract code, e.g. "ESZ6". */
  contractCode: string;
  optionType: "call" | "put";
  strike: number;
}

export function parseOptionInstrumentId(id: string): ParsedOptionId | null {
  const m = OPTION_ID_RE.exec(id);
  if (!m) return null;
  const strike = Number(m[5]);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return {
    contractCode: `${m[1].toUpperCase()}${m[2].toUpperCase()}${m[3]}`,
    optionType: m[4] === "c" ? "call" : "put",
    strike,
  };
}

/**
 * Lazily register an option instrument row for a bridge quote carrying a
 * `opt_…` id. Reuses the underlying quarterly futures contract's metadata
 * (exchange, ticks, multiplier, expiration) instead of hardcoding roots.
 *
 * Returns true when the instrument (and its provider mapping) exist after the
 * call. Returns false when the id does not parse or the underlying contract
 * row is not in the instrument master — the hub then skips persistence for
 * that quote FK-wise rather than inventing an option under an unknown root.
 */
export function ensureOptionInstrumentForQuote(q: NormalizedQuote): boolean {
  const parsed = parseOptionInstrumentId(q.instrumentId);
  if (!parsed) return false;

  const contract = queryOne<InstrumentRow>(
    "SELECT * FROM instruments WHERE LOWER(symbol) = LOWER(?) AND asset_class = 'future'",
    parsed.contractCode,
  );
  if (!contract) return false;

  const displayName = q.providerSymbol && q.providerSymbol.length > 0
    ? q.providerSymbol
    : `${contract.symbol} ${parsed.optionType === "call" ? "Call" : "Put"} ${parsed.strike}`;
  const ts = new Date().toISOString();

  try {
    queryOne(
      `INSERT OR IGNORE INTO instruments (
         id, symbol, display_name, asset_class, exchange_id, currency, price_scale, tick_size,
         contract_multiplier, expiration, futures_month, futures_year, is_continuous,
         roll_methodology, underlying_id, underlying_kind, timezone, status, deep_link,
         created_at, updated_at)
       VALUES (?, ?, ?, 'option', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'contract', ?, 'active', NULL, ?, ?)
       RETURNING id`,
      q.instrumentId,
      parsed.contractCode + (parsed.optionType === "call" ? " C" : " P") + parsed.strike,
      displayName,
      contract.exchange_id,
      contract.currency,
      contract.price_scale,
      contract.tick_size,
      contract.contract_multiplier,
      contract.expiration,
      contract.futures_month,
      contract.futures_year,
      contract.id,
      contract.timezone,
      ts,
      ts,
    );
    queryOne(
      `INSERT OR IGNORE INTO instrument_mappings (instrument_id, provider, provider_symbol, entitlement)
       VALUES (?, ?, ?, ?)
       RETURNING instrument_id`,
      q.instrumentId,
      q.provider,
      q.providerSymbol || displayName,
      q.entitlement ?? "exchange-entitlement-required",
    );
    return true;
  } catch {
    return false;
  }
}
