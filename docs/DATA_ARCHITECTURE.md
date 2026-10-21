# DATA ARCHITECTURE

Single SQLite database (`FYIP_DB_PATH`, default `./data/fyip.db`) created and
migrated by `lib/db/migrations.ts` (v1–v8, forward-only). `lib/db/index.ts` keeps
one `DatabaseSync` per process (WAL, foreign_keys ON, busy_timeout 5s) cached on
`globalThis` so Next.js HMR/worker pools never open duplicate handles.

## Volatility-aware storage shape

The pipeline distinguishes **state** from **history**:

- `quote_snapshots` — ONE bounded row per (instrument, provider): the latest
  normalized event. This is what quote surfaces read from SQLite when the
  in-process hub is cold.
- `quote_events` — optional high-frequency archive; the bundled schema only
  creates it when explicitly enabled. Storing every tick in SQLite is the wrong
  tool; if tick history is required use TimescaleDB/QuestDB with retention.
- `trade_prints` — bridge trade prints (price, size, side, `side_source`,
  provider, timestamps, status). Written at ingest; bounded by
  `FYIP_ORDERFLOW_RETENTION_HOURS` (default 72, max 720) and pruned in batches.
- `depth_snapshots` — top 15 levels per side sampled at most once per second per
  (provider, instrument). Ladders are JSON arrays; retention is shared with
  `trade_prints`.
- Bars for the archived chart-data API are aggregated from `trade_prints`
  (`archivedBars` in `lib/market/orderflow-store.ts`). Synthetic fixture bars are
  only generated when `FYIP_ENABLE_FIXTURES=true` and are labelled SIMULATED —
  never posed as real history.

This choice is deliberate: quote surfaces stay live from RAM (`MarketDataHub`)
while analytics (RISK, screener, portfolio marks) can hit SQL without a tick
hydra in the way.

## Schema overview

| Domain | Tables |
| --- | --- |
| Identity | `users`, `roles`, `user_roles`, `sessions`, `audit_log` |
| Instruments | `exchanges`, `instruments`, `instrument_mappings` |
| Market data | `quote_snapshots`, `provider_state`, `trade_prints`, `depth_snapshots` |
| News/econ/etc | `news_sources`, `news_items`, `econ_events`, `econ_series`, `econ_datapoints`, `companies`, `financials`, `filings` |
| Options/analytics | `option_chains`, `option_contracts`, `market_analytics` |
| User objects | `watchlists`, `watchlist_items`, `workspaces`, `chart_layouts`, `alerts`, `alert_events` |
| Portfolio | `portfolio_accounts`, `positions`, `trades` |
| Bots | `bots`, `bot_signals` |

Fixture-affected tables carry an `is_fixture` column so every surface can label
SIMULATED content and it can be bulk-purged (`is_fixture=1`).

## Instrument master rules

- Seeded metadata is **factual only** (symbols, magnitudes via `tick_size`,
  `contract_multiplier`, exchange metadata, expiry months) — never prices.
- Instruments exist in both continuous and contract forms: `ES` (root),
  `ES1!` (continuous view), `ESZ6` (Dec 2026 contract) ….
- Continuous rows resolve to the front contract for quote surfaces
  (`lib/market/quotes.ts#frontContractFor`, cached 60s); the roll methodology is
  stated as metadata (`roll_methodology`).
- Provider symbol mappings (`ninjatrader`, `fixture`) are stored in
  `instrument_mappings` so the desktop bridge and reference bridge share the
  same ids.

## Order-flow history

Order-flow history is collected, never reconstructed:

- Trades persist exactly as received; `side` may be `null` and `side_source`
  records `provider`, `inferred` or `unknown`. Inferred sides compare the print
  price with the live quote at ingest; they are not exchange aggressor flags.
- Depth snapshots are throttled to 1/s and keep the top 15 levels; a gap in the
  depth-history API means the server was not running or no depth arrived, not
  zero liquidity.
- Bar intervals are bucketed from trade timestamps. Empty intervals are skipped
  rather than filled with invented candles.
- History begins at first collection, so TAPE and the archived order-flow APIs
  can legitimately show less history than a vendor feed.

## Status model

See `lib/market/status.ts`: declared status (`live|delayed|historical|simulated`)
decays to `stale` after `FYIP_BRIDGE_STALE_SECONDS` (8s) without events, then
`disconnected` after `FYIP_BRIDGE_DISCONNECT_SECONDS` (30s). `unavailable`
means no source has ever provided the instrument.

**Never stored as status:** "fabricated" — if there is no data there is no data.

## PostgreSQL migration path (documented intent)

The SQL surface is deliberately plain (`SELECT/INSERT/UPSERT`, no SQLite
dialect beyond WAL pragmas). A thin adapter translating the ~10 helper queries
to Postgres shapes is a contained change; `schema_migrations` stays the same to
version both dialects.

## Backup / ops

- File = SQLite DB dir (WAL + checkpointing on clean shutdown).
- Nightly ops: `VACUUM INTO 'fyip-YYYYMMDD.db'` from cron for point-in-time
  restore; expired sessions are the only normally-deleting data.
