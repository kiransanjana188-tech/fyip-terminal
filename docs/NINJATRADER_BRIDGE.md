# NINJATRADER BRIDGE

The NinjaTrader 8 desktop platform is the only thing that can talk to real
NinjaTrader data. The bridge is therefore a **desktop Add-On that pushes
read-only market data to the terminal** — the FYIP server never contacts
NinjaTrader and has no order/account path at all.

```
NinjaTrader 8 (Windows)
  └─ FYIPBridge Add-On               bridge/ninjatrader/FYIPBridge.cs
       │   reads Documents\fyip_bridge_options.json
       │   subscribes: instrument.MarketData (+ MarketDepth) for mapped symbols
       │   batches state every 250ms
       ▼   POST /api/v1/bridge/ingest   (Authorization: Bearer FYIP_BRIDGE_TOKEN)
FYIP TERMINAL server
  └─ normalizeBridgeEvent / normalizeDepthEvent / normalizeTradeEvent
       → MarketDataHub → SSE (quotes + DOM ladders + time & sales)
```

## Install (desktop side)

1. In NinjaTrader: **New → NinjaScript Editor → Add-On → right-click Tools → Compile**,
   adding `FYIPBridge.cs` (or drop the file into
   `Documents\NinjaTrader 8\bin\Custom\AddOns\`). The Add-On was written against
   NT 8.1 / .NET 4.8; re-verify the small menu wiring against the Add-On sample
   of your NT build.
2. Edit `Documents\fyip_bridge_options.json`:

```json
{
  "url":         "http://localhost:3000",
  "token":       "value of FYIP_BRIDGE_TOKEN on the server",
  "dataStatus":  "delayed",
  "intervalMs":  250,
  "depth":       true,
  "trades":      true,
  "symbolMap":   "ES 12-26=inst_esz6;NQ 12-26=inst_nqz6",
  "optionsMap":  "ESZ6=inst_esz6;NQZ6=inst_nqz6",
  "optionStrikes": 40
}
```

3. NinjaTrader → **New → FYIP → FYIP Bridge: Connect**. Diagnostics land in
   `Documents\fyip_bridge_log.txt`.
4. After every Add-On recompile, restart NinjaTrader before reconnecting. Older
   in-process Add-On instances can keep their depth subscriptions alive and
   publish duplicate events with their own sequence counters; a restart is the
   only reliable way to clear them. Confirm one `FYIP Bridge connected` line per
   session and watch the sequence/timestamps in the log.

### symbolMap

`ninjaTraderFullSymbol = fyipInstrumentId`. FYIP instrument ids and their
NinjaTrader names live in the master:

```sql
SELECT i.symbol, i.id, m.provider_symbol
  FROM instrument_mappings m
  JOIN instruments i ON i.id = m.instrument_id
 WHERE m.provider = 'ninjatrader'
   AND i.asset_class = 'future';
-- contract rows ("ES 03-26" → inst_esz6); continuous views derive automatically
```

Mapped instruments must be OPEN in NinjaTrader somewhere (chart/analyzer/DOM)
for their `MarketData` stream to tick — NT does not deliver data for instruments
with no active subscriber window.

`"symbolMap": "ES 12-26=inst_esz6"` maps the NinjaTrader full symbol
(`ES 12-26`) to the FYIP instrument id for that quarterly contract
(`inst_esz6`); the Add-On resolves the full symbol through
`Instrument.GetInstrument` exactly like any other mapped subscription.

### CME futures options channel (`optionsMap`)

`"optionsMap": "ESZ6=inst_esz6"` enables the option channel that powers the
GEX/SURF workspaces (`ninjatrader_options` provider). Semantics:

- The contract code key (`ESZ6`) pins the CME quarterly contract the option
  grid belongs to (month code + contract-year digit, e.g. `Z`+`6` → Dec 2026).
- The value must be a FYIP instrument id that **already exists in the
  instrument master** (`inst_esz6` is seeded for the front/second quarterlies
  of every roll root). The FYIP option rows reference this contract's
  exchange/ticks/multiplier/expiration, so nothing is invented.
- On the **first quote of the underlying futures contract** (the same id mapped
  in `symbolMap`, e.g. `ES 12-26=inst_esz6`), the Add-On builds a strike grid
  centered on that price with the root's strike step
  (ES 25 · NQ 10 · RTY 5 · YM 5 · MES 5 · MNQ 2 · MYM 1 · MRTY 1),
  `optionStrikes` rows per side (default 40 → 81 strikes × 2 sides).
- For each (strike, side) it resolves the NinjaTrader instrument by trying
  candidates — `"ES 12-26 6800 Call"`, `"ES 12-26 6800 C"`, `"ESZ6 C6800"` —
  and subscribes only the ones NT actually resolves. NinjaTrader materializes
  option chains from the CME option chain data in the Options Trader; opening
  the Options Trader for the contract once (or having it cached) is what makes
  `GetInstrument` succeed. Unresolved names are skipped once and logged in
  `fyip_bridge_log.txt`.
- Quotes publish as normal `market.quote` events with FYIP ids
  `opt_<contractcode>_<c|p><strike>`, e.g. `opt_esz6_c6800` (ES Dec-2026, 6800
  call; strikes are plain digits with no fraction — supported roots all use
  integer strike steps). Open Interest arrives via
  `MarketDataType.OpenInterest` and rides the quote event's `openInterest`
  field. If your Rithmic/CME entitlement does not rebalance Open Interest, the
  chain shows rows with no OI and the GEX decks explain that nothing is
  fabricated.
- Server side, quotes for `opt_…` ids auto-register an `asset_class='option'`
  instrument row (multiplier = the underlying futures multiplier, expiration =
  the contract's expiration). The `ninjatrader_options` provider turns the
  snapshots into the GEX chain: premium = (bid+ask)/2 else last, forward F =
  the contract's latest quote, IV solved with Black-76 (r = 0,
  T = calendar days / 365), gamma from the solved IV, labelled
  `fyip_calculated`. Chain status follows the per-row `dataStatus` (the Add-On
  default is `delayed`).
- Re-arm after config edits with **Connect → Disconnect** (the strike grid is
  rebuilt on the next underlying quote).

### dataStatus policy

Keep `"delayed"` unless you hold live redistribution rights. Stock bridge data
flowing into a personal dashboard is usually fine under typical individual
entitlements, but the operator is responsible for compliance — the Add-On never
claims to be live by itself.

## Server contract

`POST /api/v1/bridge/ingest`

- **auth** — `Authorization: Bearer ${FYIP_BRIDGE_TOKEN}` (constant-time compare)
  or `x-fyip-bridge-token` header.
- **body** — one event, an array of events, or `{"events":[...]}`; ≤2 MB and
  ≤5000 events per request.
- **dataStatus (all channels)** — `live|delayed|historical|simulated` only. An
  `"unavailable"`/`"stale"` *declaration is rejected* — staleness can only be
  derived by the server.
- **response** — `{ accepted, rejected, quotes, depthLadders, trades, errors[≤10], serverTime }`.

### Channels

| eventType        | source                                   | key fields | powers    |
| ---------------- | ---------------------------------------- | ---------- | --------- |
| `market.quote`   | `instrument.MarketData` (L1)             | `bid, ask, last, open, high, low, prevClose, volume, openInterest` | QuoteGrid, header strip, positions, risk; `opt_…` ids feed the GEX/SURF options chain |
| `market.depth`   | `MarketDepth.Update` snapshots, copied inside the callback (NinjaTrader updates its ladder before raising the event) | `bids[], asks[]` as `{price, volume}`, best-first — every level the provider supplies, up to `depthLevels` per side (default 100, server max 100) | DOM ladder (`/terminal/dom`) |
| `market.trade`   | `MarketDataType.Last` prints with volume | `price, size, side (buy\|sell\|cross|null)` — side stays `null` when the feed cannot attribute | Tape (`/terminal/tape`), trade archive and bar-data API |

Validation is per channel (`normalizeBridgeEvent`, `normalizeDepthEvent`,
`normalizeTradeEvent`): `schemaVersion === 1`, `instrumentId`, `eventTimestamp`,
numeric prices/sizes, bounded arrays. Unknown instrumentIds are accepted and
stored; for `opt_<contract>_<c|p><strike>` ids the hub additionally auto-registers
the option instrument row (after validating the underlying quarterly contract
exists in the master) so the option quotes persist instead of failing the FK
silently. Non-option ids still simply don't render until a master row exists
(conservative: the bridge may push ahead of a DB re-seed).

Consumers read the three channels on one SSE connection:

```
GET /api/v1/stream/quotes?symbols=ESZ6&types=quote,depth,trade
```

Events arrive as `event: quote | depth | trade`; depth payloads are snapshots
(best-first), trade payloads are the latest from the in-memory ring (newest
first). In parallel, accepted trades are written to `trade_prints` and depth is
sampled to `depth_snapshots` (top 15 levels, at most 1/s per provider and
instrument). Both tables are pruned with
`FYIP_ORDERFLOW_RETENTION_HOURS` (default 72, max 720). This archive powers
tape history, the bar-data API and the depth-history API; history starts when the
bridge first connects. Side attribution is recorded as `provider`, `inferred`
or `unknown` — never silently upgraded.

## Testing the pipeline without NinjaTrader

```bash
# burst of simulated front contracts read from the same SQLite master
# (quotes + DOM ladders; trades are skipped in --once bursts)
npm run bridge -- --url http://localhost:3000 --once

# continuous stream: quotes + depth + trade prints
npm run bridge

# quotes + depth only (no tape prints)
npm run bridge -- --no-trades

# relay any NDJSON producer through the same endpoint
jsonlines-producer | npm run bridge -- --stdin
```

The reference bridge stamps `dataStatus: "simulated"` /
`entitlement: "development-fixture"` so terminal surfaces show the SIMULATED
badge unambiguously.

## Security notes

- Token is required: without `FYIP_BRIDGE_TOKEN` the endpoint answers
  `503 BRIDGE_NOT_CONFIGURED`; mismatched tokens get `401 BRIDGE_UNAUTHORIZED`.
- Events are market-data only (quotes, depth, trades); there is deliberately no
  order, position or account event type.
- The endpoint logs to the audit trail (admin page) with request IPs.
- Depth level-2 data may require a stronger exchange entitlement than L1/tape;
  set `dataStatus` accordingly and check your CME/NinjaTrader agreement before
  letting a browser client consume the `types=depth` stream.
- Depth is only as deep as the provider supplies (Rithmic streams the full
  book; many retail feeds stop at 10 levels per side). The Add-On copies
  NinjaTrader's snapshot ladder inside the `MarketDepth.Update` callback — the
  same book the SuperDOM shows — and DOM flags crossed snapshots rather
  than repairing them silently.
