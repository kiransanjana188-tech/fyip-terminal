import { execute, newId, queryAll, queryOne } from "@/lib/db";

export type AssetClass =
  | "equity"
  | "equity_index"
  | "etf"
  | "future"
  | "continuous_future"
  | "option"
  | "fx"
  | "commodity"
  | "rate"
  | "bond"
  | "crypto";

export interface InstrumentRow {
  id: string;
  symbol: string;
  display_name: string;
  asset_class: AssetClass;
  exchange_id: string | null;
  currency: string;
  price_scale: number;
  tick_size: number;
  contract_multiplier: number;
  expiration: string | null;
  futures_month: string | null;
  futures_year: number | null;
  is_continuous: number;
  roll_methodology: string | null;
  underlying_id: string | null;
  underlying_kind: string | null;
  timezone: string;
  status: string;
  deep_link: string | null;
}

interface ExchangeSeed {
  id: string;
  code: string;
  name: string;
  timezone: string;
  country: string;
}

interface InstrumentSeed {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string;
  currency: string;
  priceScale: number;
  tickSize: number;
  multiplier?: number;
  underlyingKind?: string;
  roll?: boolean;
}

const EXCHANGES: ExchangeSeed[] = [
  { id: "x_cme", code: "CME", name: "CME Globex", timezone: "America/Chicago", country: "US" },
  { id: "x_comex", code: "COMEX", name: "COMEX", timezone: "America/New_York", country: "US" },
  { id: "x_nymex", code: "NYMEX", name: "NYMEX", timezone: "America/New_York", country: "US" },
  { id: "x_cbot", code: "CBOT", name: "CBOT", timezone: "America/Chicago", country: "US" },
  { id: "x_nasdaq", code: "NASDAQ", name: "Nasdaq", timezone: "America/New_York", country: "US" },
  { id: "x_nyse", code: "NYSE", name: "New York Stock Exchange", timezone: "America/New_York", country: "US" },
  { id: "x_arca", code: "ARCA", name: "NYSE Arca", timezone: "America/New_York", country: "US" },
  { id: "x_fx", code: "OTC-FX", name: "OTC Foreign Exchange", timezone: "America/New_York", country: "US" },
  { id: "x_treasury", code: "UST", name: "US Treasury (yields)", timezone: "America/New_York", country: "US" },
  { id: "x_crypto", code: "CRYPTO", name: "Digital Asset Venues (aggregated)", timezone: "UTC", country: "US" },
];

const INSTRUMENTS: InstrumentSeed[] = [
  // ── Equity index futures (CME) ────────────────────────────────────────────
  { symbol: "ES", name: "E-mini S&P 500 Futures", assetClass: "future", exchange: "x_cme", currency: "USD", priceScale: 2, tickSize: 0.25, multiplier: 50, roll: true },
  { symbol: "NQ", name: "E-mini Nasdaq-100 Futures", assetClass: "future", exchange: "x_cme", currency: "USD", priceScale: 2, tickSize: 0.25, multiplier: 20, roll: true },
  { symbol: "YM", name: "E-mini Dow Futures", assetClass: "future", exchange: "x_cme", currency: "USD", priceScale: 0, tickSize: 1, multiplier: 5, roll: true },
  { symbol: "RTY", name: "E-mini Russell 2000 Futures", assetClass: "future", exchange: "x_cme", currency: "USD", priceScale: 1, tickSize: 0.1, multiplier: 50, roll: true },
  // ── Metals / energy futures ───────────────────────────────────────────────
  { symbol: "GC", name: "Gold Futures", assetClass: "future", exchange: "x_comex", currency: "USD", priceScale: 1, tickSize: 0.1, multiplier: 100, roll: true },
  { symbol: "SI", name: "Silver Futures", assetClass: "future", exchange: "x_comex", currency: "USD", priceScale: 3, tickSize: 0.005, multiplier: 5000, roll: true },
  { symbol: "CL", name: "Crude Oil Futures (WTI)", assetClass: "future", exchange: "x_nymex", currency: "USD", priceScale: 2, tickSize: 0.01, multiplier: 1000, roll: true },
  { symbol: "NG", name: "Natural Gas Futures", assetClass: "future", exchange: "x_nymex", currency: "USD", priceScale: 3, tickSize: 0.001, multiplier: 10000, roll: true },
  // ── Rates futures (CBOT) ──────────────────────────────────────────────────
  { symbol: "ZT", name: "2-Year T-Note Futures", assetClass: "future", exchange: "x_cbot", currency: "USD", priceScale: 4, tickSize: 0.0078125, multiplier: 2000, roll: true },
  { symbol: "ZF", name: "5-Year T-Note Futures", assetClass: "future", exchange: "x_cbot", currency: "USD", priceScale: 4, tickSize: 0.0078125, multiplier: 1000, roll: true },
  { symbol: "ZN", name: "10-Year T-Note Futures", assetClass: "future", exchange: "x_cbot", currency: "USD", priceScale: 4, tickSize: 0.015625, multiplier: 1000, roll: true },
  { symbol: "ZB", name: "30-Year T-Bond Futures", assetClass: "future", exchange: "x_cbot", currency: "USD", priceScale: 4, tickSize: 0.03125, multiplier: 1000, roll: true },
  // ── Cash indices ──────────────────────────────────────────────────────────
  { symbol: "SPX", name: "S&P 500 Index", assetClass: "equity_index", exchange: "x_cme", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "NDX", name: "Nasdaq-100 Index", assetClass: "equity_index", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "DJI", name: "Dow Jones Industrial Average", assetClass: "equity_index", exchange: "x_nyse", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "RUT", name: "Russell 2000 Index", assetClass: "equity_index", exchange: "x_cme", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "VIX", name: "CBOE Volatility Index", assetClass: "equity_index", exchange: "x_cme", currency: "USD", priceScale: 2, tickSize: 0.01 },
  // ── ETFs ──────────────────────────────────────────────────────────────────
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", assetClass: "etf", exchange: "x_arca", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "QQQ", name: "Invesco QQQ Trust", assetClass: "etf", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "IWM", name: "iShares Russell 2000 ETF", assetClass: "etf", exchange: "x_arca", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "GLD", name: "SPDR Gold Shares", assetClass: "etf", exchange: "x_arca", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "USO", name: "United States Oil Fund", assetClass: "etf", exchange: "x_arca", currency: "USD", priceScale: 2, tickSize: 0.01 },
  // ── Large-cap equities ────────────────────────────────────────────────────
  { symbol: "AAPL", name: "Apple Inc.", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "MSFT", name: "Microsoft Corporation", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "NVDA", name: "NVIDIA Corporation", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "AMZN", name: "Amazon.com, Inc.", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "GOOGL", name: "Alphabet Inc. Class A", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "META", name: "Meta Platforms, Inc.", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "TSLA", name: "Tesla, Inc.", assetClass: "equity", exchange: "x_nasdaq", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", assetClass: "equity", exchange: "x_nyse", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "BAC", name: "Bank of America Corporation", assetClass: "equity", exchange: "x_nyse", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "GS", name: "The Goldman Sachs Group, Inc.", assetClass: "equity", exchange: "x_nyse", currency: "USD", priceScale: 2, tickSize: 0.01 },
  { symbol: "XOM", name: "Exxon Mobil Corporation", assetClass: "equity", exchange: "x_nyse", currency: "USD", priceScale: 2, tickSize: 0.01 },
  // ── FX (spot) ─────────────────────────────────────────────────────────────
  { symbol: "EURUSD", name: "Euro / US Dollar", assetClass: "fx", exchange: "x_fx", currency: "USD", priceScale: 5, tickSize: 0.00001 },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", assetClass: "fx", exchange: "x_fx", currency: "JPY", priceScale: 3, tickSize: 0.001 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "fx", exchange: "x_fx", currency: "USD", priceScale: 5, tickSize: 0.00001 },
  { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", assetClass: "fx", exchange: "x_fx", currency: "USD", priceScale: 5, tickSize: 0.00001 },
  { symbol: "USDCAD", name: "US Dollar / Canadian Dollar", assetClass: "fx", exchange: "x_fx", currency: "CAD", priceScale: 5, tickSize: 0.00001 },
  { symbol: "USDCHF", name: "US Dollar / Swiss Franc", assetClass: "fx", exchange: "x_fx", currency: "CHF", priceScale: 5, tickSize: 0.00001 },
  // ── Spot commodities (distinct from futures) ──────────────────────────────
  { symbol: "XAUUSD", name: "Gold Spot (OTC)", assetClass: "commodity", exchange: "x_fx", currency: "USD", priceScale: 2, tickSize: 0.01, underlyingKind: "spot" },
  { symbol: "XAGUSD", name: "Silver Spot (OTC)", assetClass: "commodity", exchange: "x_fx", currency: "USD", priceScale: 3, tickSize: 0.001, underlyingKind: "spot" },
  // ── Treasury yields ───────────────────────────────────────────────────────
  { symbol: "US2Y", name: "US 2-Year Treasury Yield", assetClass: "rate", exchange: "x_treasury", currency: "USD", priceScale: 3, tickSize: 0.001 },
  { symbol: "US5Y", name: "US 5-Year Treasury Yield", assetClass: "rate", exchange: "x_treasury", currency: "USD", priceScale: 3, tickSize: 0.001 },
  { symbol: "US10Y", name: "US 10-Year Treasury Yield", assetClass: "rate", exchange: "x_treasury", currency: "USD", priceScale: 3, tickSize: 0.001 },
  { symbol: "US30Y", name: "US 30-Year Treasury Yield", assetClass: "rate", exchange: "x_treasury", currency: "USD", priceScale: 3, tickSize: 0.001 },
  // ── Crypto (venue-dependent entitlement) ──────────────────────────────────
  { symbol: "BTCUSD", name: "Bitcoin / US Dollar", assetClass: "crypto", exchange: "x_crypto", currency: "USD", priceScale: 2, tickSize: 0.5 },
  { symbol: "ETHUSD", name: "Ether / US Dollar", assetClass: "crypto", exchange: "x_crypto", currency: "USD", priceScale: 2, tickSize: 0.1 },
];

const QUARTERLY_MONTHS = [3, 6, 9, 12]; // H, M, U, Z
const QUARTER_CODE: Record<number, string> = { 3: "H", 6: "M", 9: "U", 12: "Z" };

/**
 * Compute the next N quarterly contract expirations from a reference date.
 * Methodology: index futures expire the third Friday of the contract month.
 * This is used for metadata only — it is NOT a price source.
 */
export function nextQuarterlyContracts(from: Date, count: number): { month: number; year: number; expiration: string }[] {
  const out: { month: number; year: number; expiration: string }[] = [];
  let year = from.getUTCFullYear();
  let idx = QUARTERLY_MONTHS.findIndex((m) => new Date(Date.UTC(year, m - 1, 1)) > from);
  let m = new Date(Date.UTC(year, 0, 1));
  if (idx === -1) {
    year += 1;
    idx = 0;
  }
  for (let i = 0; i < count; i++) {
    const month = QUARTERLY_MONTHS[(idx + i) % 4];
    const y = year + Math.floor((idx + i) / 4);
    out.push({ month, year: y, expiration: thirdFriday(y, month) });
    void m;
  }
  return out;
}

function thirdFriday(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  let fridays = 0;
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === 5) {
      fridays += 1;
      if (fridays === 3) return d.toISOString().slice(0, 10);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export function symbolForContract(root: string, month: number, year: number): string {
  return `${root}${QUARTER_CODE[month]}${String(year).slice(-1)}`;
}

export function isInstrumentsSeeded(): boolean {
  const row = queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM instruments");
  return (row?.c ?? 0) > 0;
}

/**
 * Seed the canonical instrument master. Factual metadata only (symbols, tick
 * sizes, multipliers, venues) — never prices. Safe to run once.
 */
export function seedInstrumentMaster(now = new Date()): void {
  if (isInstrumentsSeeded()) return;
  const ts = now.toISOString();

  for (const ex of EXCHANGES) {
    execute(
      `INSERT INTO exchanges (id, code, name, timezone, country) VALUES (?, ?, ?, ?, ?)`,
      ex.id, ex.code, ex.name, ex.timezone, ex.country,
    );
  }

  const exchangeByCode = new Map(EXCHANGES.map((e) => [e.code, e.id]));

  for (const inst of INSTRUMENTS) {
    const id = `inst_${inst.symbol.toLowerCase()}`;
    execute(
      `INSERT INTO instruments (
        id, symbol, display_name, asset_class, exchange_id, currency, price_scale, tick_size,
        contract_multiplier, expiration, futures_month, futures_year, is_continuous,
        roll_methodology, underlying_id, underlying_kind, timezone, status, deep_link,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?, ?, 'active', NULL, ?, ?)`,
      id,
      inst.symbol,
      inst.name,
      inst.assetClass,
      exchangeByCode.get(inst.exchange) ?? null,
      inst.currency,
      inst.priceScale,
      inst.tickSize,
      inst.multiplier ?? 1,
      inst.underlyingKind ?? null,
      EXCHANGES.find((e) => e.code === inst.exchange)?.timezone ?? "America/New_York",
      ts,
      ts,
    );

    // Provider mappings. `fixture` is a clearly-labelled local development feed.
    execute(
      `INSERT OR IGNORE INTO instrument_mappings (instrument_id, provider, provider_symbol, entitlement)
       VALUES (?, 'fixture', ?, 'development-fixture')`,
      id, inst.symbol,
    );
    execute(
      `INSERT OR IGNORE INTO instrument_mappings (instrument_id, provider, provider_symbol, entitlement)
       VALUES (?, 'ninjatrader', ?, 'exchange-entitlement-required')`,
      id, inst.symbol,
    );

    // Continuous futures derived from the root, with a documented roll method.
    if (inst.roll) {
      const cid = `inst_${inst.symbol.toLowerCase()}1`;
      execute(
        `INSERT INTO instruments (
          id, symbol, display_name, asset_class, exchange_id, currency, price_scale, tick_size,
          contract_multiplier, expiration, futures_month, futures_year, is_continuous,
          roll_methodology, underlying_id, underlying_kind, timezone, status, deep_link,
          created_at, updated_at)
         VALUES (?, ?, ?, 'continuous_future', ?, ?, ?, ?, ?, NULL, NULL, NULL, 1,
                 ?, ?, 'continuous', ?, 'active', NULL, ?, ?)`,
        cid,
        `${inst.symbol}1!`,
        `${inst.name} (Continuous)`,
        exchangeByCode.get(inst.exchange) ?? null,
        inst.currency,
        inst.priceScale,
        inst.tickSize,
        inst.multiplier ?? 1,
        "Volume/OI crossover roll, 3 sessions before expiry; series splices at roll without back-adjustment.",
        id,
        EXCHANGES.find((e) => e.code === inst.exchange)?.timezone ?? "America/New_York",
        ts,
        ts,
      );
      execute(
        `INSERT OR IGNORE INTO instrument_mappings (instrument_id, provider, provider_symbol, entitlement)
         VALUES (?, 'ninjatrader', ?, 'exchange-entitlement-required')`,
        cid, `${inst.symbol} ##-##`,
      );

      // Front and second quarterly contracts as distinct instruments.
      const contracts = nextQuarterlyContracts(now, 2);
      contracts.forEach((c, i) => {
        const sym = symbolForContract(inst.symbol, c.month, c.year);
        const fid = `inst_${sym.toLowerCase()}`;
        execute(
          `INSERT OR IGNORE INTO instruments (
            id, symbol, display_name, asset_class, exchange_id, currency, price_scale, tick_size,
            contract_multiplier, expiration, futures_month, futures_year, is_continuous,
            roll_methodology, underlying_id, underlying_kind, timezone, status, deep_link,
            created_at, updated_at)
           VALUES (?, ?, ?, 'future', ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 'contract', ?, 'active', NULL, ?, ?)`,
          fid,
          sym,
          `${inst.name} ${QUARTER_CODE[c.month]}${c.year}`,
          exchangeByCode.get(inst.exchange) ?? null,
          inst.currency,
          inst.priceScale,
          inst.tickSize,
          inst.multiplier ?? 1,
          c.expiration,
          QUARTER_CODE[c.month],
          c.year,
          id,
          EXCHANGES.find((e) => e.code === inst.exchange)?.timezone ?? "America/New_York",
          ts,
          ts,
        );
        execute(
          `INSERT OR IGNORE INTO instrument_mappings (instrument_id, provider, provider_symbol, entitlement)
           VALUES (?, 'ninjatrader', ?, 'exchange-entitlement-required')`,
          fid, `${inst.symbol} ${String(c.month).padStart(2, "0")}-${String(c.year).slice(-2)}`,
        );
        void i;
      });
    }
  }
}

export function listInstruments(assetClass?: string): InstrumentRow[] {
  if (assetClass) {
    return queryAll<InstrumentRow>("SELECT * FROM instruments WHERE asset_class = ? ORDER BY symbol", assetClass);
  }
  return queryAll<InstrumentRow>("SELECT * FROM instruments ORDER BY asset_class, symbol");
}

export function getInstrument(idOrSymbol: string): InstrumentRow | undefined {
  return queryOne<InstrumentRow>(
    "SELECT * FROM instruments WHERE LOWER(id) = LOWER(?) OR LOWER(symbol) = LOWER(?)",
    idOrSymbol,
    idOrSymbol,
  );
}

export function getProviderSymbol(instrumentId: string, provider: string): string | null {
  const row = queryOne<{ provider_symbol: string }>(
    "SELECT provider_symbol FROM instrument_mappings WHERE instrument_id = ? AND provider = ?",
    instrumentId,
    provider,
  );
  return row?.provider_symbol ?? null;
}

export function instrumentIdForSymbol(symbol: string): string | null {
  const row = queryOne<{ id: string }>("SELECT id FROM instruments WHERE LOWER(symbol) = LOWER(?)", symbol);
  return row?.id ?? null;
}

export { newId };