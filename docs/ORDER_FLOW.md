# ORDER FLOW

The order-flow workspaces consume the existing NinjaTrader bridge channels
(`market.depth`, `market.trade`) through the shared ingest endpoint and SSE
gateway. Nothing in this layer invents prices or volume.

## Workspaces

| Route | What it does | Data |
| --- | --- | --- |
| `/terminal/tape` | Archive + live prints, side/size filters, pause, large-print highlight, ms timestamps, session stats | `market.trade` ring + `trade_prints` (`/api/v1/market/trades`) |
| `/terminal/dom` | Read-only ladder, 10/20/30/50/100 levels, diagonal imbalance, cumulative toggle, auto-center, font scaling, flash | `market.depth` SSE |

The chart, footprint and heatmap pages are retired and their routes return 404.
Their aggregation helpers in `lib/orderflow/` and the archived-data APIs remain
available for research and future UI; no current page reconstructs or renders
footprint/heatmap values.

## Storage and retention

- `trade_prints` stores every accepted bridge print with `side` and
  `side_source` (`provider`, `inferred`, `unknown`).
- `depth_snapshots` stores the top 15 levels per side, sampled at most once per
  second per (provider, instrument).
- `FYIP_ORDERFLOW_RETENTION_HOURS` defaults to 72 (max 720). Pruning is
  best-effort and never blocks ingest.
- History begins at first collection. Empty time ranges are not filled with
  synthetic candles or liquidity; archived gaps remain gaps.

## Side attribution

NinjaTrader `MarketDataType.Last` prints do not carry an exchange aggressor
flag, so the bridge sends `side: null`. The server records:

1. `provider` when the bridge explicitly supplies `buy`, `sell` or `cross`;
2. `inferred` when the print price is at/above the live ask or at/below the
   live bid at ingest time;
3. `unknown` otherwise, including crossed or locked books.

Inferred sides are directional estimates, not exchange flags. TAPE exposes the
provenance everywhere sides are shown or aggregated.

## Computation rules

- Bars bucket prints by timeframe; open/high/low/close/volume come only from
  prints, and empty buckets are skipped. They are served by `/api/v1/bars`.
- Footprint, value-area and heatmap helpers remain in `lib/orderflow/` for
  archived-data consumers; they use unknown volume separately, the 70% value
  convention, and do not infer hidden liquidity.
- VWAP/sigma bands, SMA/EMA and RSI are deterministic calculations exposed in
  `lib/orderflow/studies.ts`.

## APIs

- `GET /api/v1/bars?symbol=ESZ6&timeframe=5m&count=600`
- `GET /api/v1/market/trades?symbol=ESZ6&limit=10000[&from=&to=]`
- `GET /api/v1/market/depth-history?symbol=ESZ6&limit=5000[&from=&to=]`

All require `market.read`. Symbols may be contract (`ESZ6`), root (`ES`) or
continuous (`ES1!`); the resolver prefers the front contract for continuous
aliases, matching the SSE gateway. Unknown symbols return an explicit 404 or an
`unavailable` payload with a reason.

## Limits

- No historical trades/depth exist before FYIP started collecting them.
- Depth history is sampled, not every book update; thin windows can look
  coarser than a vendor reconstruction.
- Crossed/locked ladders (best bid > best ask) are displayed raw in DOM with a
  warning and never repaired. They usually indicate a stale or mismatched
  upstream depth feed.
- Depth is only as deep as the provider supplies; the archive keeps the top 15
  levels even though live DOM can show up to 100.
- TAPE and DOM depend on a connected bridge; archived APIs work without one but
  cannot show data that was never collected.
- Bridge trade sides remain unknown unless the provider supplies them; inferred
  sides are labelled.
