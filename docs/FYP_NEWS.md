# FYP NEWS

FYP NEWS is the terminal's global financial-news engine. It collects documented
public feeds, stores every item with provenance, groups repeated reports into
clusters, and renders headlines with explicit timestamps, verification and
interpretation labels. It does **not** scrape paywalled pages, invent missing
text, or turn a rule-based impact note into a trading signal.

## Official FinancialJuice headlines widget

`/terminal/news` opens on the **FINANCIALJUICE** tab, which embeds the provider's
official headline widget. The **FYIP ENGINE** tab contains the independent
collected-stories engine described below. The two sources have separate status,
data and attribution; no FinancialJuice headline is copied into the FYIP
database by the widget.

Official generator: <https://www.financialjuice.com/widgets/get-widget.aspx>

FYIP loads the generator's helper and creates the `NEWS` widget with:

```js
FJWidgets.createWidget({
  container: "financialjuice-news-widget-container",
  height: "100%",
  width: "100%",
  mode: "Dark",
  backColor: "1e222d",
  fontColor: "b2b5be",
  widgetType: "NEWS"
});
```

The helper injects the generated provider iframe:

```text
https://feed.financialjuice.com/widgets/headlines.aspx
  ?wtype=NEWS&mode=Dark&container=financialjuice-news-widget-container
  &width=100%25&height=100%25&backC=1e222d&fontC=b2b5be&affurl=
```

FYIP only overrides the generated iframe's outer width/height/border CSS so it
fills the workspace responsively. It does not proxy, scrape, alter or restyle
cross-origin provider content, and the in-widget "Powered By FinancialJuice"
attribution is retained.

Widget status is deliberately narrow:

- `LOADING` - the provider helper is being fetched.
- `INITIALISING` - the helper is ready and FYIP is waiting for the iframe.
- `AVAILABLE` - the iframe's `load` event fired. This does **not** prove the
  headline feed is live or current; FinancialJuice controls that.
- `UNAVAILABLE` - the helper/iframe failed or timed out. FYIP shows the actual
  state, a provider link and a reload control; it does not fabricate headlines.

FYIP cannot inspect the cross-origin iframe, so an in-provider login, subscribe,
empty-feed or error page cannot be classified by FYIP. The UI never labels the
widget "live".

At implementation time the public widget loaded without an FYIP API key, FYIP
login, or provider domain registration, and the response did not declare an
`X-Frame-Options`/CSP frame restriction. No FinancialJuice account or paid
entitlement is used. Commercial use, provider terms and any future domain or
licensing restrictions remain the operator's responsibility. The provider page
runs its own scripts, cookies and analytics inside the iframe; FYIP sends it no
credentials. Automated or headless browsers may receive provider bot protection
even when a normal browser loads the widget.

## Honesty rails

- Publication time is nullable. A missing provider timestamp is shown as
  `PUB?` / `UNKNOWN`; FYIP's receipt time is never substituted for it.
- `publishedAt`, `sourceUpdatedAt`, `receivedAt` and `ingestedAt` are distinct.
- A provider summary is shown only when the provider supplied one. FYIP does not
  generate a summary unless the operator explicitly enables the optional AI
  helper, and that output is labelled machine-generated.
- Verification labels are descriptive, not legal confirmation.
- Market impact notes are rule-based transmission channels ("interpretation"),
  with confidence values and a `two-way`/`watch` direction when the rules cannot
  justify a direction.
- Unavailable feeds are listed with the reason. There is no HTML scraping
  fallback and no silent placeholder story.
- Every story carries source attribution and license notes.

## Registered sources

Endpoints and parsers are code-defined. Administrators can enable/disable a
registered source and change its interval, but cannot enter arbitrary URLs.

| Key | Source | Cadence | Notes |
| --- | --- | --- | --- |
| `gdelt` | GDELT DOC 2.0 | 15 min | Aggregator; `seendate` is stored as observation time, not publication time. Public endpoint has been returning HTTP 429 from this deployment; health shows the real error and exponential backoff. |
| `federalreserve` | Federal Reserve press releases | 10 min | Official RSS. |
| `bls` | US Bureau of Labor Statistics | 15 min | Official RSS releases. |
| `bea` | US Bureau of Economic Analysis | 30 min | Official RSS releases. |
| `ecb` | European Central Bank | 15 min | Official RSS press feed. |
| `boe` | Bank of England | 15 min | Official RSS news feed. |
| `boj` | Bank of Japan | 20 min | Official English What's New RSS. |
| `boc` | Bank of Canada | 20 min | RSS 1.0/RDF press-release feed. |
| `rba` | Reserve Bank of Australia | 30 min | RSS 1.0/RDF media releases. |
| `sec` | SEC press releases | 15 min | Official RSS. |
| `sec-8k` | SEC EDGAR current 8-K filings | 15 min | Atom. A filing is a company statement, not FYIP verification. |
| `eia` | US EIA Today in Energy | 30 min | Official RSS. |
| `treasury` | US Treasury | disabled | No verified public RSS/Atom endpoint at implementation time; HTML is not scraped. |
| `cftc` | CFTC | disabled | Same limitation. |

All network calls use HTTPS, an exact-host allowlist, no credentials in URLs,
and are re-checked after redirects. A redirect outside the allowlist fails
closed. The collector only reads syndication/JSON feeds; it does not fetch
article bodies.

RSS 2.0, RSS 1.0 (RDF), Atom and GDELT JSON are supported. Missing links and
titles shorter than 8 characters are skipped rather than guessed.

## Collection model

There is no always-on Netlify scheduler in this deployment.

- **Workstation/local:** a process-local collector runs every 60 seconds while
  the server is running (disable with `FYIP_NEWS_COLLECTOR=off`). A refresh or
  an open SSE stream can also trigger collection.
- **Netlify/Postgres:** collection runs on demand from the FYP NEWS SSE stream
  (on connect and every 30 seconds while connected) and from manual REFRESH.
  Coverage outside active sessions is therefore not guaranteed. The Source
  Health panel states this limitation.
- Every due source is claimed in the database by pushing `next_attempt_at`
  forward, so concurrent requests/instances do not normally fetch the same feed
  twice.
- A request budget limits work per invocation (Postgres: 2 sources / about 8s;
  local: 4 sources / about 20s). Remaining sources are handled later.
- ETag / Last-Modified conditional requests are used when the provider supports
  them.
- Failures use exponential backoff (starting from the source interval, capped at
  30 minutes) and `Retry-After` when supplied.
- Successful collection and error counts are recorded in `news_ingest_runs`;
  the latest 40 runs are retained.

## Timestamp semantics

| Field | Meaning |
| --- | --- |
| `publishedAt` | Timestamp supplied by the provider for publication. May be `null`. |
| `publishedKnown` | Whether a plausible provider publication timestamp was parsed. |
| `sourceUpdatedAt` | Provider-declared update/observation time. For GDELT this is `seendate`. |
| `receivedAt` | When FYIP first accepted the item from the feed. |
| `ingestedAt` | When FYIP stored it. Currently equal/close to `receivedAt`. |

Dates are normalized to ISO format. Unrecognized or implausible values are
rejected as publication timestamps instead of being replaced with FYIP receipt
time. Values older than 1990 or more than six hours in the future are rejected.
GDELT `seendate` never becomes `publishedAt`.

## Deduplication and clustering

- Provider item identity is `(provider_key, provider_item_id)`.
- URLs are canonicalized (tracking parameters, fragments, common trailing
  punctuation/slashes normalized where safe).
- A normalized title Jaccard similarity of at least **0.86** is treated as a
  duplicate within the comparison window; content hash is also used.
- Reports between **0.50** and the duplicate threshold that are within 36 hours
  are marked related and share a `cluster_id`. The original story is not
  overwritten by a later report's headline.
- Duplicate reports add their source reference to the existing story and update
  the verification label without overwriting the original headline, summary or
  publication time. Developments remain separate rows in the same cluster
  rather than deleting history.
- Title normalization removes punctuation/case and common feed noise for
  comparison; alert prefixes remain part of the stored headline.

## Verification, priority and impact labels

Verification is computed from the story's source set:

- `unverified` - source language itself signals uncertainty (`reportedly`,
  `unconfirmed`, `claims`, ...).
- `official` - at least one official/primary source is present.
- `corroborated` - three or more independent provider keys.
- `multi-source` - two independent provider keys.
- `single-source` - one provider key.

Priority is derived from urgency/relevance rules and the category. A breaking
flag requires a matching high-urgency rule; labels are not confirmation.

Potential market channels map rule matches to a small set of liquid proxies
(`US10Y`, `DXY`, `ES`, `GC`, and others depending on the rule). Each impact has
a mechanism, a confidence value and `isInterpretation: true`. Direction is
`two-way` or `watch` when the rule does not justify a one-sided reading.
These notes are not forecasts, recommendations or signals.

## HTTP API

All routes require a signed session and the stated permission.

| Method | Route | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/news/stories` | `news.read` | Paginated stories; filters: `category`, `region`, `provider`, `priority`, `breaking=1`, `saved=1`, `q`, `sinceHours`, `limit`, `offset`, `sort=newest\|published\|priority\|relevance`. |
| GET | `/api/v1/news/stories/:id` | `news.read` | Story, related cluster items and source health for its providers. |
| GET | `/api/v1/news/health` | `news.read` | Counts, source health, last ingest run, collection mode, AI status. |
| POST | `/api/v1/news/collect` | `news.read` | Run a budgeted collection of due sources now. |
| GET | `/api/v1/news/saved` | `news.read` | Saved headlines for the current user. |
| POST | `/api/v1/news/saved` | `news.save` | Save/unsave `{ storyId, saved }`. |
| DELETE | `/api/v1/news/saved?storyId=...` | `news.save` | Remove a saved headline. |
| GET | `/api/v1/news/settings` | `admin.providers` | Registry, policy, AI status and settings. |
| PATCH | `/api/v1/news/settings` | `admin.providers` | Update retention, collection enabled, custom keywords, source enabled/interval. |
| POST | `/api/v1/news/summarize` | `news.read` | Optional AI summary of existing source text only. |
| GET | `/api/v1/news/stream` | `news.read` | SSE live feed. |

The legacy `/api/v1/news` route and the home `NewsWire` widget are preserved for
backward compatibility; the FYP NEWS page uses the story API above.

### SSE events

`/api/v1/news/stream` emits:

- `hello` - server time, methodology/disclaimer, AI and collection status.
- `snapshot` - latest 30 stories, counts, source health.
- `story` - a new or updated story (DB polling every 3 seconds).
- `counts` - updated counters after story changes.
- `health` - source health every 60 seconds and after collection.
- `collect` - collection summary.
- `ping` - keepalive every 15 seconds.

The function has `maxDuration = 60`; EventSource reconnects automatically.
Pausing the UI freezes the visible list but does not stop collection.

## UI behavior

`/terminal/news` provides two source tabs:

- **FINANCIALJUICE** (default) - the official provider embed described above,
  with responsive sizing, honest embed states, provider attribution and a
  direct provider link.
- **FYIP ENGINE** - the independent collected wire with all of the following.

The FYIP engine view provides:

- Breaking ticker, category/region/source filters, search and four sort modes.
- Publication time (`PUB?` when unknown), FYIP receipt time and provider delay.
- Verification/priority badges, cluster size, entities and symbols.
- Story context: timestamp audit, provider summary, source list with official
  markers, related cluster, attribution/license and rule-based impact channels.
- Save/unsave for users with `news.save` (viewer/guest remain read-only).
- Optional AI summary button only when the operator configured a model.
- Pause/resume with pending count; ingestion continues while paused.
- Optional breaking alert tone (Web Audio; user gesture required).
- Source Health panel with status, interval, latency, item count, last error and
  the exact endpoint.
- Admin modal for enable/disable, intervals, retention, collection toggle and
  custom keywords.

## Optional AI summarization

Disabled unless all three variables are set:

```text
FYIP_AI_BASE_URL=https://your-openai-compatible-endpoint/v1
FYIP_AI_API_KEY=...
FYIP_AI_MODEL=...
```

`FYIP_AI_BASE_URL` must be HTTPS, except localhost/127.0.0.1 for development.
Summaries are constrained to the provider-supplied summary text, capped in
length, and labelled machine-generated. Headline-only stories are not
summarized because there is no source text. All other FYP NEWS features work
without AI.

## Retention

Default retention is 30 days; admins can set 7-365 days. Pruning runs at most
once per 24 hours after a collection. Impact rows and saved-headline references
for removed stories are deleted with the story. `news_ingest_runs` keeps the
latest 40 runs.

## Known limitations

- The FinancialJuice widget is a cross-origin provider embed. FYIP can detect
  only the iframe load event, not individual headline freshness, a provider
  login/error page, or server-side feed health.
- Provider bot protection may challenge automated/headless browsers even though
  the widget loads in a normal browser.
- The official widget is independent of FYIP source health and saved headlines;
  it does not populate the FYP NEWS database.
- GDELT's public endpoint may rate-limit the deployment IP (HTTP 429). Health
  reports the failure and backoff; other sources continue.
- Netlify collection depends on an active FYP NEWS session/stream or manual
  refresh; there is no guaranteed background polling.
- Feeds expose only headline/summary/link as published. FYIP does not fetch full
  article text.
- Some official sites publish HTML only or block automated access; those
  providers remain disabled/unavailable rather than being scraped.
- A publication time absent from the feed stays unknown.
- Verification counts independent provider keys, not independent journalism;
  syndication and shared wire copy are not detected.
- RSS 1.0 feeds are supported for items whose links are absolute; relative-link
  RDF feeds should be added with a fixture test.
- SSE/function lifetime limits mean reconnects are normal; the UI shows
  RECONNECTING while EventSource retries.

## Verification

```bash
npx vitest run tests/fyp-news.test.ts tests/fyp-news-db.test.ts
npm run typecheck
npm run lint
npm run build
```

`tests/fyp-news.test.ts` covers parsing (RSS 2.0, RSS 1.0/RDF, Atom, GDELT),
timestamp honesty, dedupe/clustering, verification/backoff/stream helpers.
`tests/fyp-news-db.test.ts` applies migrations to a temporary SQLite database
and exercises source seeding, ingestion, listing/saved state, settings, stream
updates and pruning.
