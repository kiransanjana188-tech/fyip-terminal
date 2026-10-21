#!/usr/bin/env node
/**
 * FYIP TERMINAL — reference bridge client.
 *
 * Goals (dev tooling, not production data):
 *   1. Prove the /api/v1/bridge/ingest pipeline end-to-end without NinjaTrader,
 *      using the same event contract as bridge/ninjatrader/FYIPBridge.cs.
 *   2. Relay newline-delimited JSON events from stdin (so any desktop app,
 *      spreadsheet macro, or test harness can push events without an Add-On).
 *
 * Honesty rules mirror the server:
 *   - synthetic mode stamps every event dataStatus "simulated"
 *     ("entitlement": "development-fixture") so the UI renders SIMULATED;
 *   - stdin relay passes caller-provided fields through unchanged and the
 *     server still validates schemaVersion/eventType/dataStatus/etc.
 *
 * Usage:
 *   npm run bridge -- [--url U] [--token T] [--interval ms] [--once]
 *                     [--roots ES,NQ,GC] [--db path] [--stdin] [--base ES=6200.25]
 *                     [--no-depth | --depth-levels N] [--trades | --no-trades]
 *
 * Channels by default: market.quote + market.depth (+ market.trade in stream
 * mode; --once bursts skip trades). Reference emitters only — real data comes
 * from bridge/ninjatrader/FYIPBridge.cs inside NinjaTrader.
 *
 * The underlier universe and front contracts are read from the local SQLite
 * instrument master (same DB the server uses), so posted instrumentIds always
 * resolve to real rows. Use --base to pin an anchor price per root; otherwise a
 * synthetic-but-deterministic anchor is derived per symbol.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function arg(name, fallback = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  if (i >= 0) return true;
  return fallback;
}

const URL_BASE = arg("url", process.env.FYIP_BRIDGE_TARGET_URL ?? "http://localhost:3000");
const TOKEN = arg("token", process.env.FYIP_BRIDGE_TOKEN ?? "");
const INTERVAL = Number(arg("interval", process.env.FYIP_BRIDGE_INTERVAL_MS ?? 1000));
const ONCE = args.includes("--once");
const STDIN = args.includes("--stdin");
/** Depth/trade channels (market.depth + market.trade) — on by default in stream mode. */
const DEPTH = args.includes("--no-depth") ? false : true;
const TRADES = args.includes("--trades") || (!ONCE && !args.includes("--no-trades"));
const DEPTH_LEVELS = Number(arg("depth-levels", 10));
const DB_PATH_CFG = arg("db", process.env.FYIP_DB_PATH ?? "./data/fyip.db");
const ROOTS = String(arg("roots", "")).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const BASES = {};
for (const pair of String(arg("base", "")).split(",")) {
  if (!pair.includes("=")) continue;
  const [k, v] = pair.split("=");
  if (/^\d+(\.\d+)?$/.test(v.trim())) BASES[k.trim().toUpperCase()] = Number(v);
}

const MONTH_NAME = { 3: "Mar", 6: "Jun", 9: "Sep", 12: "Dec" };

function fail(msg) {
  console.error(`[fyip-bridge] ${msg}`);
  process.exit(1);
}

function postEvents(bodyValue) {
  return fetch(`${URL_BASE}/api/v1/bridge/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "x-fyip-bridge-client": "reference-bridge",
    },
    body: JSON.stringify(bodyValue),
  })
    .then(async (res) => {
      const body = await res.text();
      return { status: res.status, body };
    })
    .catch((err) => ({ status: 0, body: String(err) }));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 14), 61 | t)) ^ t;
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

function hashSymbol(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic synthetic anchor per symbol — a DEV utility, never market data. */
function anchorFor(symbol, tick) {
  const base = BASES[symbol.slice(0, 2).toUpperCase()];
  if (base !== undefined) return base;
  const anchors = { ES: 6200, NQ: 22400, YM: 45600, RTY: 2350, GC: 2400, SI: 31, CL: 78, NG: 3.5, ZT: 104, ZF: 111, ZN: 116, ZB: 121 };
  for (const [root, value] of Object.entries(anchors)) {
    if (symbol.startsWith(root)) return value;
  }
  return 100 + (hashSymbol(symbol) % 500) * tick;
}

/** Front contract (per root) + its NinjaTrader mapping symbol, from the instrument master. */
function loadFrontContracts() {
  const dbPath = path.isAbsolute(DB_PATH_CFG) ? DB_PATH_CFG : path.join(process.cwd(), DB_PATH_CFG);
  if (!fs.existsSync(dbPath)) {
    fail(`instrument master not found at ${dbPath} — run the terminal once (npm run db:migrate) or pass --db`);
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    db = new DatabaseSync(dbPath); // fall back for engines without readOnly option
  }
  try {
    const rows = db
      .prepare(
        `SELECT c.id, c.symbol, c.tick_size, c.futures_month, c.futures_year, c.underlying_id,
                m.provider_symbol
           FROM instruments c
           LEFT JOIN instrument_mappings m
                  ON m.instrument_id = c.id AND m.provider = 'ninjatrader'
          WHERE c.asset_class = 'future'
            AND c.underlying_kind = 'contract'
            AND c.expiration IS NOT NULL AND c.expiration >= ?
          ORDER BY c.underlying_id, c.expiration ASC`,
      )
      .all(new Date().toISOString());
    const front = new Map();
    for (const r of rows) {
      if (!front.has(r.underlying_id)) front.set(r.underlying_id, r); // first row = earliest expiry
    }
    return [...front.values()];
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

function syntheticUniverse() {
  let contracts = loadFrontContracts();
  if (ROOTS.length > 0) {
    // contract symbols like "ESH6": the letters prefix is the root
    contracts = contracts.filter((c) => {
      const root = c.symbol.replace(/[^A-Za-z!]/g, "").replace(/!+$/, "");
      return ROOTS.some((r) => root.startsWith(r));
    });
  }
  if (contracts.length === 0) fail("no front contracts matched — check --roots (e.g. --roots ES,NQ)");
  const state = new Map();
  for (const c of contracts) {
    const tick = Number(c.tick_size) || 1;
    state.set(c.id, {
      symbol: c.symbol,
      providerSymbol: c.provider_symbol || `${c.symbol}`,
      tick,
      last: anchorFor(c.symbol, tick),
      volume: Math.floor(hashSymbol(c.symbol) % 10000),
      rand: mulberry32(hashSymbol(c.symbol)),
    });
  }
  return state;
}

function buildEvent(st, nowIso) {
  const { rand, tick } = st;
  const drift = (rand() - 0.5) * st.last * 0.0015;
  st.last = Math.round((st.last + drift) / tick) * tick;
  const spread = tick * (1 + Math.floor(rand() * 3));
  st.volume += Math.floor(rand() * 500);
  return {
    schemaVersion: 1,
    eventType: "market.quote",
    provider: "ninjatrader",
    instrumentId: st.instrumentId,
    providerSymbol: st.providerSymbol,
    eventTimestamp: nowIso,
    receivedTimestamp: nowIso,
    dataStatus: "simulated",
    entitlement: "development-fixture",
    bid: st.last - spread / 2,
    ask: st.last + spread / 2,
    last: st.last,
    volume: st.volume,
    openInterest: null,
  };
}

function buildDepth(st, nowIso) {
  const { rand, tick } = st;
  const halfSpread = tick * (1 + Math.floor(rand() * 2)); // gap around the mid
  const bids = [];
  const asks = [];
  let bp = st.last - halfSpread;
  let ap = st.last + halfSpread;
  for (let i = 0; i < DEPTH_LEVELS; i++) {
    bids.push({ price: bp, volume: Math.max(1, Math.floor(rand() * 400)) });
    asks.push({ price: ap, volume: Math.max(1, Math.floor(rand() * 400)) });
    bp = Math.round((bp - tick) * 1e6) / 1e6;
    ap = Math.round((ap + tick) * 1e6) / 1e6;
  }
  return {
    schemaVersion: 1,
    eventType: "market.depth",
    provider: "ninjatrader",
    instrumentId: st.instrumentId,
    providerSymbol: st.providerSymbol,
    eventTimestamp: nowIso,
    receivedTimestamp: nowIso,
    dataStatus: "simulated",
    entitlement: "development-fixture",
    bids,
    asks,
  };
}

function buildTrade(st, nowIso) {
  const { rand, tick } = st;
  const size = 1 + Math.floor(rand() * 50);
  const side = rand() < 0.5 ? "sell" : "buy";
  const px = side === "buy" ? st.last + tick * 0.5 : st.last - tick * 0.5;
  return {
    schemaVersion: 1,
    eventType: "market.trade",
    provider: "ninjatrader",
    instrumentId: st.instrumentId,
    providerSymbol: st.providerSymbol,
    eventTimestamp: nowIso,
    receivedTimestamp: nowIso,
    dataStatus: "simulated",
    entitlement: "development-fixture",
    price: px,
    size,
    side,
    sequence: null,
  };
}

async function stdinMode() {
  console.error(`[fyip-bridge] stdin relay → ${URL_BASE} (one JSON event/batch per line, Ctrl+C to stop)`);
  const rl = (await import("node:readline")).createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.error("[fyip-bridge] skipped non-JSON line");
      continue;
    }
    const res = await postEvents(parsed);
    console.error(`[fyip-bridge] POST ${res.status}`);
  }
}

async function syntheticMode() {
  if (!TOKEN) fail("FYIP_BRIDGE_TOKEN is not set (and no --token given). The server rejects unauthenticated POSTs.");
  const state = syntheticUniverse();
  for (const [id, st] of state) st.instrumentId = id;
  console.error(
    `[fyip-bridge] synthetic DEMO feed (dataStatus=simulated) → ${URL_BASE}; ` +
      `channels: quote${DEPTH ? "+depth" : ""}${TRADES ? "+trades" : ""}; ` +
      `${state.size} instruments: ${[...state.values()].map((s) => s.providerSymbol).join(", ")}`,
  );
  let sent = 0;
  let depthCount = 0;
  let tradeCount = 0;
  const tick = async () => {
    const nowIso = new Date().toISOString();
    const events = [...state.values()].map((st) => buildEvent(st, nowIso));
    if (DEPTH) {
      // one ladder per instrument, capped to keep batches small
      for (const st of [...state.values()].slice(0, 6)) events.push(buildDepth(st, nowIso));
    }
    if (TRADES) {
      const st0 = [...state.values()][Math.floor(Math.random() * state.size)];
      st0 && events.push(buildTrade(st0, nowIso));
      const st1 = [...state.values()][Math.floor(Math.random() * state.size)];
      st1 && events.push(buildTrade(st1, nowIso));
    }
    const res = await postEvents(events);
    sent += events.length;
    depthCount += DEPTH ? Math.min(6, state.size) : 0;
    tradeCount += TRADES ? 2 : 0;
    if (res.status === 200) {
      let accepted = "?";
      let breakdown = "";
      try {
        const body = JSON.parse(res.body);
        accepted = String(body.accepted);
        if (body.depthLadders || body.trades) breakdown = ` (q${body.quotes}/d${body.depthLadders}/t${body.trades})`;
      } catch { /* ignore */ }
      console.error(`[fyip-bridge] sent ${events.length} (total ${sent}), accepted ${accepted}${breakdown}`);
    } else {
      console.error(`[fyip-bridge] POST failed ${res.status}: ${res.body.slice(0, 200)}`);
      if (res.status === 401) fail("bridge token rejected — check FYIP_BRIDGE_TOKEN on both sides");
    }
    if (!ONCE) timer = setTimeout(tick, INTERVAL);
  };
  let timer = null;
  await tick();
  if (ONCE) console.error("[fyip-bridge] --once: burst complete");
  else {
    process.on("SIGINT", () => {
      console.error(`\n[fyip-bridge] stopped after ${sent} events`);
      process.exit(0);
    });
  }
}

if (STDIN) await stdinMode();
else await syntheticMode();
