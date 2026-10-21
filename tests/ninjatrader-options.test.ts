import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// DB integration slice: these tests opt into the real node:sqlite driver (the
// test stub re-exports it when FYIP_TEST_ENABLE_DB=1) against a dedicated temp
// file so no test ever touches the workspace data DB.
const dbPath = path.join(
  process.env.TEMP ?? process.env.TMPDIR ?? "/tmp",
  `fyip-nt-options-test-${process.pid}.db`,
);

let black76Mod: typeof import("../lib/finance/black76");
let optionInstrumentMod: typeof import("../lib/market/option-instrument");
let providerMod: typeof import("../lib/providers/ninjatrader-options");
let hubMod: typeof import("../lib/market/hub");
let dbMod: typeof import("../lib/db");
let registryMod: typeof import("../lib/providers/registry");
let optionsMod: typeof import("../lib/market/options");

beforeAll(async () => {
  process.env.FYIP_TEST_ENABLE_DB = "1";
  process.env.FYIP_BRIDGE_TOKEN = "test-bridge-token";
  process.env.FYIP_DB_PATH = dbPath;
  [black76Mod, optionInstrumentMod, providerMod, hubMod, dbMod, registryMod, optionsMod] =
    await Promise.all([
      import("../lib/finance/black76"),
      import("../lib/market/option-instrument"),
      import("../lib/providers/ninjatrader-options"),
      import("../lib/market/hub"),
      import("../lib/db"),
      import("../lib/providers/registry"),
      import("../lib/market/options"),
    ]);
});

function seedInstruments(): void {
  dbMod.getDb().exec(`
    INSERT OR IGNORE INTO exchanges (id, code, name, timezone, country)
      VALUES ('x_cme', 'CME', 'CME Globex', 'America/Chicago', 'US');
    INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange_id, currency,
        price_scale, tick_size, contract_multiplier, expiration, futures_month, futures_year,
        is_continuous, roll_methodology, underlying_id, underlying_kind, timezone, status,
        deep_link, created_at, updated_at)
      VALUES ('inst_es', 'ES', 'E-mini S&P 500 Futures', 'future', 'x_cme', 'USD',
        2, 0.25, 50, NULL, NULL, NULL, 0, NULL, NULL, 'root', 'America/New_York', 'active',
        NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT OR IGNORE INTO instruments (id, symbol, display_name, asset_class, exchange_id, currency,
        price_scale, tick_size, contract_multiplier, expiration, futures_month, futures_year,
        is_continuous, roll_methodology, underlying_id, underlying_kind, timezone, status,
        deep_link, created_at, updated_at)
      VALUES ('inst_esz6', 'ESZ6', 'E-mini S&P 500 Dec 26', 'future', 'x_cme', 'USD',
        2, 0.25, 50, '2026-12-18', 'Z', 2026, 0, NULL, 'inst_es', 'contract',
        'America/New_York', 'active', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    INSERT OR IGNORE INTO instrument_mappings (instrument_id, provider, provider_symbol, entitlement)
      VALUES ('inst_esz6', 'ninjatrader', 'ES 12-26', 'exchange-entitlement-required');
  `);
}

function upsertSnapshot(instrumentId: string, cols: Record<string, number | null | string>): void {
  dbMod
    .getDb()
    .prepare(
      `INSERT OR REPLACE INTO quote_snapshots (
         instrument_id, provider, provider_symbol, exchange, bid, ask, last, open, high, low,
         prev_close, volume, open_interest, data_status, entitlement, event_timestamp,
         received_timestamp, updated_at)
       VALUES (?, 'ninjatrader', ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, 'delayed',
               NULL, ?, ?, ?)`,
    )
    .run(
      instrumentId,
      cols.providerSymbol ?? null,
      cols.bid ?? null,
      cols.ask ?? null,
      cols.last ?? null,
      cols.volume ?? null,
      cols.openInterest ?? null,
      cols.eventTimestamp ?? "2026-10-20T14:00:00.000Z",
      cols.receivedTimestamp ?? "2026-10-20T14:00:00.000Z",
      cols.receivedTimestamp ?? "2026-10-20T14:00:00.000Z",
    );
}

afterAll(() => {
  try {
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(dbPath + "-wal", { force: true });
    fs.rmSync(dbPath + "-shm", { force: true });
  } catch { /* temp cleanup */ }
});

it("Black-76 prices the ATM straddle with the documented gamma", () => {
  const { black76, black76Gamma } = black76Mod;
  const call = black76({ forward: 100, strike: 100, timeToExpiry: 0.5, vol: 0.2, type: "call" });
  const put = black76({ forward: 100, strike: 100, timeToExpiry: 0.5, vol: 0.2, type: "put" });
  expect(call).not.toBeNull();
  expect(put).not.toBeNull();
  // r = 0 with F = K: call and put prices match (each ≈ 5.6369 = 100 · 2·φ(0)·d1)
  expect(call!.price).toBeCloseTo(5.6369, 3);
  expect(put!.price).toBeCloseTo(5.6369, 3);
  expect(call!.delta).toBeCloseTo(0.5282, 3);
  expect(put!.delta).toBeCloseTo(-0.4718, 3);
  expect(call!.gamma).toBeCloseTo(0.0281, 3);
  expect(black76Gamma({ forward: 100, strike: 100, timeToExpiry: 0.5, vol: 0.2 })).toBeCloseTo(0.0281, 3);
});

it("Black-76 deep strikes keep gamma positive but tiny", () => {
  const far = black76Mod.black76({ forward: 100, strike: 140, timeToExpiry: 0.25, vol: 0.2, type: "put" });
  expect(far).not.toBeNull();
  expect(far!.gamma).toBeGreaterThan(0);
  expect(far!.gamma).toBeLessThan(0.01);
});

it("Black-76 IV bisection recovers the input and rejects out-of-band premiums", () => {
  const { black76ImpliedVol } = black76Mod;
  const solved = black76ImpliedVol(5.637, { forward: 100, strike: 100, timeToExpiry: 0.5, type: "call" });
  expect(solved).not.toBeNull();
  expect(solved!).toBeGreaterThan(0.1);
  expect(solved!).toBeLessThan(0.3);
  expect(black76ImpliedVol(190, { forward: 100, strike: 100, timeToExpiry: 0.5, type: "call" })).toBeNull();
  expect(black76ImpliedVol(-1, { forward: 100, strike: 100, timeToExpiry: 0.5, type: "call" })).toBeNull();
});

it("parses the NinjaTrader option-id grammar strictly", () => {
  const { parseOptionInstrumentId } = optionInstrumentMod;
  expect(parseOptionInstrumentId("opt_esz6_c6800")).toEqual({
    contractCode: "ESZ6",
    optionType: "call",
    strike: 6800,
  });
  expect(parseOptionInstrumentId("opt_nqz6_p20500")).toEqual({
    contractCode: "NQZ6",
    optionType: "put",
    strike: 20500,
  });
  expect(parseOptionInstrumentId("inst_esz6")).toBeNull();
  expect(parseOptionInstrumentId("opt_esz6_x6800")).toBeNull();
  expect(parseOptionInstrumentId("opt_esz6_c")).toBeNull();
  expect(parseOptionInstrumentId("opt_esz6_c6800.5")).toBeNull();
  expect(parseOptionInstrumentId("opt_esz6_c6675")).not.toBeNull();
  expect(parseOptionInstrumentId("opt_abc_c1")).toBeNull();
});

it("auto-registers option instruments from bridge quotes", () => {
  const { ensureOptionInstrumentForQuote } = optionInstrumentMod;
  const { getDb } = dbMod;
  seedInstruments();
  const quote = {
    schemaVersion: 1 as const,
    eventType: "market.quote" as const,
    provider: "ninjatrader",
    instrumentId: "opt_esz6_c6800",
    providerSymbol: "ES 12-26 6800 Call",
    exchange: null,
    eventTimestamp: "2026-10-20T14:00:00.000Z",
    receivedTimestamp: "2026-10-20T14:00:00.000Z",
    sequence: 1,
    dataStatus: "delayed" as const,
    bid: 21,
    ask: 23,
    last: 22,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: 120,
    openInterest: 1234,
    entitlement: "exchange-entitlement-required",
  };
  expect(ensureOptionInstrumentForQuote(quote)).toBe(true);
  const row = getDb().prepare("SELECT * FROM instruments WHERE id = 'opt_esz6_c6800'").get() as {
    asset_class: string;
    underlying_id: string | null;
    contract_multiplier: number;
    expiration: string | null;
    display_name: string;
  };
  expect(row.asset_class).toBe("option");
  expect(row.underlying_id).toBe("inst_esz6");
  expect(row.contract_multiplier).toBe(50);
  expect(row.expiration).toBe("2026-12-18");
  expect(row.display_name).toBe("ES 12-26 6800 Call");
  const mapping = getDb().prepare(
    "SELECT provider_symbol FROM instrument_mappings WHERE instrument_id = 'opt_esz6_c6800' AND provider = 'ninjatrader'",
  ).get() as { provider_symbol: string };
  expect(mapping.provider_symbol).toBe("ES 12-26 6800 Call");
});

it("refuses option registration when the underlying contract row is missing", () => {
  const { ensureOptionInstrumentForQuote } = optionInstrumentMod;
  const { getDb } = dbMod;
  const quote = {
    schemaVersion: 1 as const,
    eventType: "market.quote" as const,
    provider: "ninjatrader",
    instrumentId: "opt_esu7_c6800",
    providerSymbol: "ES 09-27 6800 Call",
    exchange: null,
    eventTimestamp: "2026-10-20T14:00:00.000Z",
    receivedTimestamp: "2026-10-20T14:00:00.000Z",
    sequence: 1,
    dataStatus: "delayed" as const,
    bid: 21,
    ask: 23,
    last: 22,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: null,
    openInterest: null,
    entitlement: null,
  };
  expect(ensureOptionInstrumentForQuote(quote)).toBe(false);
  expect(getDb().prepare("SELECT 1 FROM instruments WHERE id = 'opt_esu7_c6800'").get())
    .toBeUndefined();
});

it("builds the CME chain from bridge snapshots with Black-76 IV/gamma", async () => {
  const { ensureOptionInstrumentForQuote } = optionInstrumentMod;
  seedInstruments();
  for (const [id, symbol] of [
    ["opt_esz6_c6800", "ES 12-26 6800 Call"],
    ["opt_esz6_p6700", "ES 12-26 6700 Put"],
  ] as const) {
    expect(
      ensureOptionInstrumentForQuote({
        schemaVersion: 1 as const,
        eventType: "market.quote" as const,
        provider: "ninjatrader",
        instrumentId: id,
        providerSymbol: symbol,
        exchange: null,
        eventTimestamp: "2026-10-20T14:00:00.000Z",
        receivedTimestamp: "2026-10-20T14:00:00.000Z",
        sequence: 1,
        dataStatus: "delayed" as const,
        bid: null,
        ask: null,
        last: null,
        open: null,
        high: null,
        low: null,
        prevClose: null,
        volume: null,
        openInterest: null,
        entitlement: "exchange-entitlement-required",
      }),
    ).toBe(true);
  }
  upsertSnapshot("inst_esz6", {
    providerSymbol: "ES 12-26",
    bid: 6799.5,
    ask: 6800,
    last: 6799.75,
    openInterest: 0,
    receivedTimestamp: "2026-10-20T14:00:00.000Z",
  });
  upsertSnapshot("opt_esz6_c6800", {
    providerSymbol: "ES 12-26 6800 Call",
    bid: 21,
    ask: 23,
    last: 22,
    volume: 9,
    openInterest: 1200,
    receivedTimestamp: "2026-10-20T14:00:00.000Z",
  });
  upsertSnapshot("opt_esz6_p6700", {
    providerSymbol: "ES 12-26 6700 Put",
    bid: 30.5,
    ask: 31.5,
    last: 31,
    volume: 4,
    openInterest: 800,
    receivedTimestamp: "2026-10-20T14:00:00.000Z",
  });

  const provider = new providerMod.NinjaTraderOptionsProvider();
  expect(provider.supportedSymbols()).toEqual(["ES", "NQ"]);
  const chain = await provider.fetchChain("inst_es");
  expect(chain.length).toBe(2);
  const callRow = chain.find((c) => c.strike === 6800)!;
  expect(callRow.expiration).toBe("2026-12-18");
  expect(callRow.underlyingPrice).toBeCloseTo(6799.75, 6);
  expect(callRow.impliedVol).not.toBeNull();
  expect(callRow.impliedVol!).toBeGreaterThan(0.01);
  expect(callRow.impliedVol!).toBeLessThan(1);
  expect(callRow.gamma).not.toBeNull();
  expect(callRow.greeksSource).toBe("fyip_calculated");
  expect(callRow.openInterest).toBe(1200);
});

it("serves ninjatrader_options through the workspace loader returning per-row status", async () => {
  const providers = registryMod.listOptionsProviders();
  expect(providers[0]?.key).toBe("ninjatrader_options");
  expect(providers[0]?.isConfigured()).toBe(true);

  const chain = await optionsMod.loadOptionsChain("ES");
  expect(chain.available).toBe(true);
  expect(chain.source).toBe("ninjatrader_options");
  expect(chain.spot).toBeCloseTo(6799.75, 6);
  expect(chain.dataStatus).toBe("delayed");
  expect(chain.expirations).toHaveLength(1);
  expect(chain.contracts.find((c) => c.strike === 6800)?.gamma).not.toBeNull();
});

it("flags missing open interest honestly instead of hiding it", async () => {
  dbMod.execute("UPDATE quote_snapshots SET open_interest = NULL WHERE instrument_id LIKE 'opt_esz6_%'");
  const chain = await optionsMod.loadOptionsChain("ES");
  expect(chain.available).toBe(true);
  expect(chain.warnings.some((w) => w.includes("open interest"))).toBe(true);
});
