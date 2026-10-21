# FYIP TERMINAL

A Bloomberg-style institutional financial intelligence workstation: real backend,
auth + RBAC, SQLite persistence, a provider-adapter market-data pipeline, and a
keyboard-driven terminal UI — done as an honest Phase-1 build. Nothing is faked:
statuses, fixtures and blocked capabilities are always labelled.

## Stack

- **Next.js 14 (App Router) full-stack** — API routes are the backend
- **`node:sqlite`** locally / **Netlify Database (PostgreSQL)** in production, behind one sync query facade
- **SSE** for live quote push (`/api/v1/stream/quotes`)
- **lightweight-charts + canvas** for market charts and the 3D GEX surface
- **vitest** (143 tests), **ESLint**, **tsc** strict

## Run it

```bash
npm install
cp .env.example .env.local      # FYIP_SESSION_SECRET etc.
npm run dev                     # http://localhost:3000 → /terminal
npm run db:migrate              # apply pending migrations to ./data/fyip.db (optional: app auto-applies)
npm test
npm run build && npm start
```

### Minimum production env

| Variable | Notes |
| --- | --- |
| `FYIP_SESSION_SECRET` | required (≥16 chars) in production; signs session cookies |
| `FYIP_ADMIN_EMAIL` / `FYIP_ADMIN_PASSWORD` | seeds the admin user on first boot |
| `FYIP_BRIDGE_TOKEN` | enables NinjaTrader bridge ingestion (`POST /api/v1/bridge/ingest`) |
| `FYIP_ENABLE_FIXTURES` | `true` enables the SIMULATED dev feed (never affects live data) |
| `FYIP_DISABLE_GUEST` | `true` disables read-only guest sessions (`POST /api/v1/auth/guest`) |

log in at `/login` with `FYIP_ADMIN_EMAIL`+`FYIP_ADMIN_PASSWORD` — or open the
terminal straight away in read-only **guest mode** at `/guest`.

## Data flow

```
NinjaTrader 8 Add-On ─┐                      ┌─ SSE  stream/quotes ─ terminal UI
reference bridge    ──┤→ bridge/ingest ──┐   │
vendor providers*     ┘                  ▼   ▼
   (+ SIMULATED fixtures)         MarketDataHub → latest-wins per instrument
                                   │            (throttled snapshot persistence)
                                   ├─ trade_prints / depth_snapshots (order-flow archive)
                                   ▼
                             SQLite (instruments, snapshots, news, portfolio…)
```

There are **no prices without a source**. With no bridge/credentials configured,
quote surfaces show `UNAVAILABLE`. Flip `FYIP_ENABLE_FIXTURES=true` to drive the
workstation with clearly-badged `SIMULATED` market and options-chain data.

## Bridge (NinjaTrader)

1. Compile `bridge/ninjatrader/FYIPBridge.cs` as an Add-On inside NinjaTrader 8
   (NT → Tools → My NinjaScript → Add-On).
2. Edit `Documents\fyip_bridge_options.json` (url/token/dataStatus/symbolMap;
   add `optionsMap` + `optionStrikes` to stream CME futures options — see
   `docs/NINJATRADER_BRIDGE.md`).
3. NinjaTrader → New → FYIP → **FYIP Bridge: Connect**.
4. Or test the pipeline without NT:

```bash
$env:FYIP_BRIDGE_TOKEN="dev-bridge-token-change-me"
node bridge/reference-bridge.mjs --url http://localhost:3113 --once   # quotes+depth burst
npm run bridge                                                        # quotes+depth+trades stream
echo '{"schemaVersion":1,"eventType":"market.quote","instrumentId":"inst_esz6","providerSymbol":"ES 03-26","eventTimestamp":"2026-10-19T14:00:00Z","dataStatus":"simulated","last":6200.25}' | npm run bridge -- --stdin
```

Depth (DOM) and trade prints (tape) ride the same ingest endpoint as
`market.depth` / `market.trade` events and stream to `/terminal/dom` and
`/terminal/tape` via `types=depth|trade` — see `docs/NINJATRADER_BRIDGE.md`.
Accepted trades and throttled depth snapshots are also archived to SQLite so
TAPE and the archived order-flow APIs survive page reloads and server restarts.
History starts at first collection; retention is controlled by
`FYIP_ORDERFLOW_RETENTION_HOURS` (default 72h).

## Order flow

- `/terminal/tape` — archive + live prints, side/size filters, pause,
  large-print highlight, ms timestamps, session stats.
- `/terminal/dom` — read-only ladder, 10/20/30/50/100 levels, diagonal imbalance,
  cumulative toggle, auto-center, font scaling, flash. Crossed/locked snapshots
  are flagged in DOM rather than silently repaired.
- The retired chart, footprint and heatmap pages are no longer routed; their
  aggregation helpers and archived-data APIs remain available.

Aggressor sides are only "provider" when the bridge supplies them; otherwise
prints are inferred against the live quote and labelled "inferred", or stay
"unknown". No bid/ask volume is reconstructed from OHLC.

## FYP NEWS

`/terminal/news` opens on the official **FinancialJuice headlines** embed, with
provider attribution retained and honest iframe states (never labelled "live"
from a load event alone). The separate **FYIP ENGINE** tab is the independent
collected wire: documented public feeds (Fed, BLS, BEA, ECB, BoE, BoJ, BoC, RBA,
SEC press + 8-K, EIA, and GDELT when not rate-limited), RSS/Atom/RDF parsing,
honest nullable publication timestamps, dedupe/clusters, verification labels,
saved headlines and rule-based impact notes. Collection is request/SSE-triggered
on Netlify (no always-on scheduler); the local server also runs a 60-second
collector. Source Health exposes every upstream error instead of hiding it.

Optional AI summaries require an OpenAI-compatible endpoint
(`FYIP_AI_BASE_URL`, `FYIP_AI_API_KEY`, `FYIP_AI_MODEL`) and use only
provider-supplied summary text. See [docs/FYP_NEWS.md](docs/FYP_NEWS.md).

## Derivatives

- `/terminal/gex` — synchronized A/B gamma-exposure profiles per expiration or
  underlying, with green call / red put bars, a yellow cumulative curve, spot
  line, gamma flip, resistance/support estimates and a documented unit selector.
- `/terminal/surface` — interactive strike × expiration × GEX surface; drag to
  rotate, wheel to zoom, hover/click to inspect, yellow spot marker, teal positive
  / magenta negative color scale, surface/grid/color-scale controls.
- Convention: dollar gamma per 1% move
  (`gamma × OI × multiplier × spot² × 0.01`) or per 1 point move
  (`gamma × OI × multiplier × spot`). Dealers are assumed long call / short put
  gamma; this is an assumption, not observed positioning.
- With no options provider, both pages show **NO OPTIONS DATA PROVIDER**. The
  NinjaTrader bridge can act as the options provider for ES/NQ (real CME futures
  options + open interest via `optionsMap`); SPY/QQQ/SPX/NDX use a 100 options
  multiplier, ES/NQ use 50/20. Set `FYIP_ENABLE_FIXTURES=true` only for
  clearly-labelled SIMULATED development chains.

## Module status (honest)

Implemented: HOME, MKT, NEWS, CAL, MACRO, EQ, SCAN, OPT, PORT, RISK, ADMIN, FYPBOT (framework).
Partial: TAPE, DOM, FUT, GEX, SURF, VOL (order flow depends on a connected
bridge; GEX/SURF depend on an options provider; history starts at collection).
Scaffolded (labelled in-UI): EARN, FILINGS, LAB, BACKTEST.
Retired workspaces: CHART, FOOT, HEAT (routes removed; shared helpers and
archived-data APIs remain).
See `docs/IMPLEMENTATION_MATRIX.md`.

## Docs

- [docs/FYP_NEWS.md](docs/FYP_NEWS.md) — news sources, collection model, timestamps, verification, API/SSE
- [docs/PROVIDERS.md](docs/PROVIDERS.md) — adapter contract, registry, blockers
- [docs/NINJATRADER_BRIDGE.md](docs/NINJATRADER_BRIDGE.md) — bridge install/contract
- [docs/ORDER_FLOW.md](docs/ORDER_FLOW.md) — order-flow workspaces, data rules and limits
- [docs/DATA_ARCHITECTURE.md](docs/DATA_ARCHITECTURE.md) — storage + retention
- [docs/SECURITY_LICENSING.md](docs/SECURITY_LICENSING.md) — hardening + entitlement rules
- [docs/IMPLEMENTATION_MATRIX.md](docs/IMPLEMENTATION_MATRIX.md) — module-by-module truth table
