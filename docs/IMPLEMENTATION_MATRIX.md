# IMPLEMENTATION MATRIX

Status codes: **READY** (implemented, tested), **PARTIAL** (core reachable,
depth pending), **SCAFFOLD** (UI frame + honest status badge), **BLOCKED**
(needs entitlement/queue of external work — labelled as such).

Terminal sidebar status dots are driven by `lib/modules.ts` — what you see in
the UI is this table.

| Key | Module | Status | What exists |
| --- | --- | --- | --- |
| HOME | Landing/dash | READY | overview panels, module grid, connection health |
| MKT | Markets | READY | quote grid + SSE merge, watchlist add, status badges, continuous→front resolution |
| NEWS | FYP NEWS | READY | 12 enabled public feeds plus 2 unavailable registry entries (Treasury, CFTC); 11 healthy, GDELT rate-limited, RSS/Atom/RDF/GDELT parsing, honest publication timestamps, per-user saved headlines, dedupe/clusters, verification labels, rule-based impact notes, SSE live wire + source health/admin; serverless collection is request/SSE-triggered |
| CAL | Econ calendar | READY | calendar/day events with `is_fixture` flags; importance colours |
| MACRO | Macro series | READY | FRED-shaped series surface; empty series list until `FRED_API_KEY` + fetcher wired |
| EQ | Equities research | READY | companies table (11 seeded profiles), quote + metrics; filings listed as BLOCKED |
| EARN | Earnings | SCAFFOLD | honest scaffold page |
| FILINGS | SEC filings | SCAFFOLD | `secedgar` stub registered with blocker |
| SCAN | Screener + alerts | READY | asset-class screener over live statuses + volume/price gates; alert engine (fire-once, re-arm) |
| OPT | Options calc | READY | BSM pricing + greeks (server-computed, `fyip_calculated`), IV solver, chain surface |
| GEX | Futures profile | READY | futures-only analytics from NinjaTrader bridge trade prints: session levels, VWAP, volume-at-price rows, POC + 70% value area and session buy/sell delta; no options data used |
| SURF | 3D volume surface | READY | canvas time × price × volume surface from executed prints with rotate/zoom, hover/click pin and buy/sell-dominant coloring; same bridge trades channel |
| FUT | Futures detail | SCAFFOLD | contango/roll pages pending historical storage |
| TAPE | Time & sales | PARTIAL | archive + live `market.trade` prints, side/size filters, pause, large-print highlight, ms timestamps, session stats; in-memory ring plus 72h SQLite archive |
| DOM | Depth ladder | PARTIAL | live `market.depth` ladder, 10/20/30/50/100 levels, diagonal imbalance highlight, cumulative toggle, font scaling, auto-center, flash; DOM is read-only |
| VOL | Volatility surface | SCAFFOLD | scaffolded IV view; no real option feeds yet |
| PORT | Portfolio | READY | holdings CRUD + marks from latest quotes; **trading placeholder only — no order flow takes place** |
| RISK | Risk analytics | READY | net exposure by class, contrived concentration + leverage views; no VaR yet |
| ADMIN | Admin | READY | providers (blockers), users/roles, audit log |
| FYPBOT | Trading bots | PARTIAL | bot registry + signal log storage + RBAC (`bots.control`); engines not attached |
| LAB | Research lab | SCAFFOLD | scaffold |
| BACKTEST | Backtest | SCAFFOLD | scaffold (needs historical data source first) |

Retired workspaces: CHART, FOOT and HEAT routes/navigation entries were removed.
Their shared order-flow helpers and archived-data APIs remain for research use.

## Honesty rails

- Any surface fed by fixtures renders a SIMULATED badge (`lib/client/status.ts`).
- SCAFFOLD pages explain **why** they are blocked and what unblocks them.
- UNAVAILABLE is a first-class status, never replaced by invented values.
