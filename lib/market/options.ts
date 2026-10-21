import { queryAll } from "@/lib/db";
import { quoteHub } from "@/lib/market/hub";
import { getInstrument } from "@/lib/market/instruments";
import type { DataStatus } from "@/lib/market/status";
import { listOptionsProviders } from "@/lib/providers/registry";
import type { OptionContractQuote } from "@/lib/providers/types";

export interface OptionsSymbolConfig {
  symbol: string;
  label: string;
  /** Options contract multiplier — NOT the underlying instrument multiplier. */
  contractMultiplier: number;
}

/**
 * Supported GEX underlyings and their option contract multipliers.
 * SPY/QQQ/SPX/NDX options deliver 100 shares per contract. ES/NQ options are
 * futures options with the futures multiplier (50 / 20). These are deliberately
 * separate from `instruments.contract_multiplier`, which describes the spot or
 * futures instrument, not its options.
 */
export const OPTIONS_SYMBOLS: OptionsSymbolConfig[] = [
  { symbol: "SPY", label: "SPY · SPDR S&P 500 ETF", contractMultiplier: 100 },
  { symbol: "QQQ", label: "QQQ · Invesco QQQ Trust", contractMultiplier: 100 },
  { symbol: "SPX", label: "SPX · S&P 500 Index", contractMultiplier: 100 },
  { symbol: "NDX", label: "NDX · Nasdaq-100 Index", contractMultiplier: 100 },
  { symbol: "ES", label: "ES · E-mini S&P 500 (futures options)", contractMultiplier: 50 },
  { symbol: "NQ", label: "NQ · E-mini Nasdaq-100 (futures options)", contractMultiplier: 20 },
];

export const OPTIONS_PROVIDER_REQUIREMENT =
  "An options-enabled provider with strikes, expirations, open interest and gammas or implied vol (e.g. the NinjaTrader bridge with CME futures options, or Polygon.io with an options plan).";

export interface LoadedOptionContract {
  expiration: string;
  strike: number;
  optionType: "call" | "put";
  openInterest: number;
  impliedVol: number | null;
  gamma: number | null;
  asOf: string;
  /** Best-status hint the source carried per row, if any. */
  dataStatus?: DataStatus;
}

export interface OptionsExpiration {
  expiration: string;
  dteDays: number;
  contracts: number;
}

export interface LoadedOptionsChain {
  symbol: string;
  instrumentId: string | null;
  available: boolean;
  reason: string | null;
  source: string;
  sourceLabel: string;
  dataStatus: DataStatus;
  asOf: string | null;
  spot: number | null;
  contractMultiplier: number;
  contracts: LoadedOptionContract[];
  expirations: OptionsExpiration[];
  warnings: string[];
}

export function getOptionsSymbolConfig(symbol: string): OptionsSymbolConfig | undefined {
  return OPTIONS_SYMBOLS.find((s) => s.symbol === symbol.toUpperCase());
}

export function dteDays(expiration: string, from = new Date()): number {
  const exp = Date.parse(`${expiration.slice(0, 10)}T20:00:00Z`);
  if (!Number.isFinite(exp)) return 0;
  return Math.max(0, Math.round((exp - from.getTime()) / 86_400_000));
}

export function listExpirations(contracts: LoadedOptionContract[], from = new Date()): OptionsExpiration[] {
  const byExpiration = new Map<string, number>();
  for (const c of contracts) {
    if (!(c.openInterest > 0)) continue;
    byExpiration.set(c.expiration, (byExpiration.get(c.expiration) ?? 0) + 1);
  }
  return [...byExpiration.entries()]
    .map(([expiration, count]) => ({ expiration, dteDays: dteDays(expiration, from), contracts: count }))
    .filter((e) => e.dteDays >= 0)
    .sort((a, b) => a.expiration.localeCompare(b.expiration));
}

function normalize(rows: OptionContractQuote[]): LoadedOptionContract[] {
  return rows
    .filter((r) => typeof r.strike === "number" && r.strike > 0)
    .map((r) => ({
      expiration: r.expiration.slice(0, 10),
      strike: r.strike,
      optionType: r.optionType,
      openInterest: Math.max(0, Number(r.openInterest ?? 0)),
      impliedVol: r.impliedVol ?? null,
      gamma: r.gamma ?? null,
      asOf: r.asOf ?? new Date().toISOString(),
      dataStatus: r.dataStatus ?? undefined,
    }));
}

/**
 * Derive the chain-level status from the per-row statuses the source carries.
 * Sources without per-row statuses stay "historical" (previous behaviour);
 * bridge rows mix live/delayed per snapshot and upgrade honestly.
 */
function deriveChainDataStatus(contracts: LoadedOptionContract[]): DataStatus {
  const statuses = new Set<DataStatus>();
  for (const c of contracts) if (c.dataStatus) statuses.add(c.dataStatus);
  if (statuses.size === 0) return "historical";
  if (statuses.size === 1) return [...statuses][0];
  // Mixed rows: report the least favourable common status.
  if (statuses.has("unavailable")) return "unavailable";
  if (statuses.has("delayed")) return "delayed";
  if (statuses.has("simulated")) return "simulated";
  return "historical";
}

function spotFrom(rows: OptionContractQuote[], instrumentId: string | null): number | null {
  for (const row of rows) {
    if (typeof row.underlyingPrice === "number" && row.underlyingPrice > 0) return row.underlyingPrice;
  }
  if (!instrumentId) return null;
  const quote = quoteHub.get(instrumentId);
  return quote?.last ?? quote?.bid ?? quote?.ask ?? null;
}

function emptyChain(symbol: string, reason: string, warnings: string[] = []): LoadedOptionsChain {
  const cfg = getOptionsSymbolConfig(symbol);
  return {
    symbol,
    instrumentId: null,
    available: false,
    reason,
    source: "none",
    sourceLabel: "No provider",
    dataStatus: "unavailable",
    asOf: null,
    spot: null,
    contractMultiplier: cfg?.contractMultiplier ?? 100,
    contracts: [],
    expirations: [],
    warnings,
  };
}

export async function loadOptionsChain(symbolInput: string): Promise<LoadedOptionsChain> {
  const symbol = symbolInput.toUpperCase();
  const cfg = getOptionsSymbolConfig(symbol);
  if (!cfg) {
    return emptyChain(symbol, `${symbol} is not a supported GEX underlying. Supported: ${OPTIONS_SYMBOLS.map((s) => s.symbol).join(", ")}.`);
  }
  const inst = getInstrument(symbol);
  if (!inst) return emptyChain(symbol, `Instrument metadata for ${symbol} is not seeded.`);

  const blockers: string[] = [];
  for (const provider of listOptionsProviders()) {
    if (!provider.isConfigured()) continue;
    const supported = provider.supportedSymbols?.();
    if (supported && !supported.includes(symbol)) {
      blockers.push(`${provider.label} does not serve ${symbol}`);
      continue;
    }
    try {
      const chain = await provider.fetchChain(inst.id);
      const contracts = normalize(chain);
      const spot = spotFrom(chain, inst.id);
      if (contracts.length === 0) {
        blockers.push(`${provider.label} returned no contracts for ${symbol}`);
        continue;
      }
      if (!spot) {
        blockers.push(`${provider.label} returned no underlying price for ${symbol}`);
        continue;
      }
      const asOf = chain
        .map((c) => c.asOf)
        .filter((v): v is string => typeof v === "string")
        .sort()
        .at(-1) ?? new Date().toISOString();
      const warnings: string[] = [];
      if (!contracts.some((c) => c.openInterest > 0)) {
        warnings.push(
          `${provider.label} returned no rows with positive open interest — GEX levels require open interest.`,
        );
      }
      return {
        symbol,
        instrumentId: inst.id,
        available: true,
        reason: null,
        source: provider.key,
        sourceLabel: provider.label,
        dataStatus: provider.key === "fixture_options" ? "simulated" : deriveChainDataStatus(contracts),
        asOf,
        spot,
        contractMultiplier: cfg.contractMultiplier,
        contracts,
        expirations: listExpirations(contracts),
        warnings,
      };
    } catch (err) {
      blockers.push(`${provider.label}: ${(err as Error).message}`);
    }
  }

  const stored = queryAll<{
    expiration: string;
    strike: number;
    option_type: "call" | "put";
    open_interest: number | null;
    implied_vol: number | null;
    gamma: number | null;
    underlying_price: number | null;
    source: string;
    as_of: string;
  }>(
    `SELECT expiration, strike, option_type, open_interest, implied_vol, gamma,
            underlying_price, source, as_of
       FROM options_snapshots
      WHERE underlying_id = ?
        AND as_of = (SELECT MAX(as_of) FROM options_snapshots WHERE underlying_id = ?)
      ORDER BY expiration, strike`,
    inst.id,
    inst.id,
  );
  if (stored.length > 0) {
    const contracts = normalize(
      stored.map((r) => ({
        expiration: r.expiration,
        strike: r.strike,
        optionType: r.option_type,
        bid: null,
        ask: null,
        last: null,
        volume: null,
        openInterest: r.open_interest,
        impliedVol: r.implied_vol,
        gamma: r.gamma,
        greeksSource: r.gamma === null ? "fyip_calculated" : "provider",
        underlyingPrice: r.underlying_price,
        asOf: r.as_of,
      })),
    );
    const spot = stored.find((r) => typeof r.underlying_price === "number" && r.underlying_price > 0)?.underlying_price
      ?? spotFrom([], inst.id);
    if (contracts.length > 0 && spot) {
      const source = stored[0].source;
      return {
        symbol,
        instrumentId: inst.id,
        available: true,
        reason: null,
        source: "stored",
        sourceLabel: `Stored snapshots (${source})`,
        dataStatus: source.includes("simulated") ? "simulated" : "historical",
        asOf: stored[0].as_of,
        spot,
        contractMultiplier: cfg.contractMultiplier,
        contracts,
        expirations: listExpirations(contracts),
        warnings: ["Using the latest archived options snapshot; no provider is configured."],
      };
    }
  }

  const reason = blockers.length > 0
    ? `No usable options chain for ${symbol}. ${blockers.join(" · ")}`
    : `No options data provider is configured. ${OPTIONS_PROVIDER_REQUIREMENT}`;
  return emptyChain(symbol, reason, blockers);
}

export function selectExpiration(
  chain: LoadedOptionsChain,
  requested: string | null,
  fallbackIndex = 0,
): string | null {
  const expirations = chain.expirations;
  if (expirations.length === 0) return null;
  if (requested) {
    const match = expirations.find((e) => e.expiration === requested);
    if (match) return match.expiration;
  }
  return expirations[Math.min(Math.max(0, fallbackIndex), expirations.length - 1)]?.expiration ?? null;
}
