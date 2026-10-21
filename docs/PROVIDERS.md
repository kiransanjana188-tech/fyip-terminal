# PROVIDERS

Every external data source is an **adapter** behind one internal contract.
Adapters never touch the UI directly: normalized events flow into the
`MarketDataHub`, which owns merging, snapshot persistence and staleness. The UI
only ever renders data plus a status.

## Adapter contract (server-side)

`lib/providers/types.ts`

```ts
interface MarketDataProvider {
  key: string; kind: "market_data"; label: string;
  capabilities(): ProviderCapabilities;   // declared honestly, shown in ADMIN
  isConfigured(): boolean;                // env/credential check only
  start(sink: (q: NormalizedQuote) => void): void;   // push adapter
  stop(): void;
}
```

`ProviderCapabilities`: `live, delayed, historical, depth, streaming, options,
fundamentals, symbolSearch, entitlement` — each is displayed in the ADMIN
providers page *as declared by the adapter*, regardless of current health.

## Normalized quote events

`NormalizedQuote` (schemaVersion 1, eventType `market.quote`) carries:
`provider, instrumentId, providerSymbol, exchange, eventTimestamp,
receivedTimestamp, sequence, dataStatus, bid, ask, last, open, high, low,
prevClose, volume, openInterest, entitlement`.

- Numeric fields may be `null` — they are **never coerced to 0**.
- `dataStatus` ∈ `live | delayed | historical | simulated` may arrive from a
  provider; simplification to stale/disconnected happens in the status model.

## Status model

`dataStatus` is always one of
`live | delayed | stale | disconnected | historical | simulated | unavailable`.
Declared freshness decays over time: a `live` feed Older than
`FYIP_BRIDGE_STALE_SECONDS` (default 8s) renders `stale`; after
`FYIP_BRIDGE_DISCONNECT_SECONDS` (default 30s) it renders `disconnected`.

## Registry

`lib/providers/registry.ts` owns four adapter lists — `marketData`, `news`,
`economic`, `options` — and `ensureProvidersStarted()` (idempotent, called by
the API bootstrap). `providerSummaries()` powers the ADMIN page, including each
adapter's `blocker` (what's missing, e.g. `FINNHUB_API_KEY unset`).

### Implemented adapters

| key | kind | behaviour | blocker when unconfigured |
| --- | --- | --- | --- |
| `fixture` | market_data | deterministic synthetic walk, **SIMULATED**; exists only when `FYIP_ENABLE_FIXTURES=true`; stores `is_fixture=1` rows for news/econ seeds | feature flag |
| `fixture_options` | options | deterministic synthetic chains for SPY/QQQ/SPX/NDX/ES/NQ, **SIMULATED**; exists only when `FYIP_ENABLE_FIXTURES=true` | feature flag |
| `ninjatrader` | market_data | push via `/api/v1/bridge/ingest` (Bearer token, timing-safe compare) | `FYIP_BRIDGE_TOKEN` |
| `ninjatrader_options` | options | real CME futures-option quotes pushed by the NinjaTrader Add-On (`optionsMap`); chain built from `quote_snapshots`, IV/gamma FYIP-computed with Black-76 (r = 0); ES/NQ roots; per-row `dataStatus` (Add-On default `delayed`) | `FYIP_BRIDGE_TOKEN` + `optionsMap` in `fyip_bridge_options.json` |
| `finnhub`  | stub market/news | `UnavailableError` until key present | `FYIP_FINNHUB_API_KEY` |
| `alphavantage` | stub market | same | `FYIP_ALPHAVANTAGE_API_KEY` |
| `polygon`  | stub market/options | `UnavailableError`; options chains require a real adapter and an options-enabled plan | `FYIP_POLYGON_API_KEY` |
| `fred`     | stub economic | same | `FYIP_FRED_API_KEY` |
| `newsapi`  | stub news | same | `FYIP_NEWSAPI_API_KEY` |
| `financialjuice` | stub news (squawk) | same | `FYIP_FINANCIALJUICE_API_KEY` |
| `secedgar` | stub filings | same | outbound network access |

Stubs intentionally `throw UnavailableError` — a provider without credentials
must never emit fake values. They are visible in ADMIN with their blocker.

The public **FinancialJuice headlines widget** on `/terminal/news` is a separate
official client-side embed. It uses no `FYIP_FINANCIALJUICE_API_KEY`, squawk
websocket or FYIP collector. Provider terms, domain restrictions and any
commercial-use requirements are documented in
[docs/FYP_NEWS.md](FYP_NEWS.md#official-financialjuice-headlines-widget).

## Options chains (GEX / 3D surface)

`OptionsDataProvider.fetchChain(underlyingId)` returns contracts with expiration,
strike, option type, open interest, implied vol and (optionally) provider gamma.
`supportedSymbols()` is optional; GEX limits requests to:

| Symbol | Options contract multiplier |
| --- | --- |
| SPY / QQQ / SPX / NDX | 100 |
| ES / NQ | 50 / 20 |

`ninjatrader_options` serves ES/NQ only (CME futures options pushed by the
bridge Add-On, see docs/NINJATRADER_BRIDGE.md). For ES/NQ the underlying price
is the latest quote of the mapped quarterly futures contract (e.g. ESZ6), not a
spot index.

The options multiplier is intentionally separate from the spot/futures
instrument multiplier. When no options adapter is configured, the options chain,
GEX and surface endpoints return an explicit `available: false` payload with the
provider requirement — the pages render **NO OPTIONS DATA PROVIDER** rather than
substituting values. Gamma may be provider-supplied or FYIP-computed from IV;
`computedGammaShare` records the mix.

If no provider is available, `/api/v1/gex/workspace` may fall back to the latest
archived `options_snapshots` snapshot for the underlying and labels it
`historical`. Development fixtures are always labelled `simulated`.

## FYP NEWS feed adapters

FYP NEWS uses a separate server-only registry in `lib/news/providers/index.ts`.
These adapters return normalized `ParsedNewsItem` records; they do not touch the
market-data hub. Endpoints are code-defined and exact-host allowlisted, and
administrators cannot add arbitrary URLs.

| Key | Format | Cadence | Status |
| --- | --- | --- | --- |
| `gdelt` | GDELT DOC 2.0 JSON | 15 min | Registered; public endpoint currently rate-limits this deployment (HTTP 429), reported honestly with backoff |
| `federalreserve` | RSS | 10 min | Official |
| `bls` | RSS | 15 min | Official |
| `bea` | RSS | 30 min | Official |
| `ecb` | RSS | 15 min | Official |
| `boe` | RSS | 15 min | Official |
| `boj` | RSS | 20 min | Official |
| `boc` | RSS 1.0 / RDF | 20 min | Official |
| `rba` | RSS 1.0 / RDF | 30 min | Official |
| `sec` | RSS | 15 min | Official |
| `sec-8k` | Atom | 15 min | Official filings; company statements |
| `eia` | RSS | 30 min | Official |
| `treasury` | - | disabled | No verified machine-readable endpoint; HTML is not scraped |
| `cftc` | - | disabled | Same |

Collection is request/SSE-triggered in the Netlify deployment because no
always-on scheduler is configured; the local server also runs a 60-second
collector. Provider interval and DB backoff are minimum gaps, not guarantees.
See `docs/FYP_NEWS.md` for timestamp, dedupe, verification and licensing rules.

## Entitlements

`entitlement` renders on every quote surface (the entitlement string from the
event) and should be respected: exchange data requiring redistribution
permission must not leave the operator's own deployment.
