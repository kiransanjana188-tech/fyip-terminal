# SECURITY & LICENSING

## Authentication

- Passwords: **scrypt** (N=16384, r=8, p=1) with per-user salt
  (`lib/auth/password.ts`); stored as `scrypt$N$r$p$salt$hash` for transparent
  upgrade later.
- Sessions: server-side rows in `sessions`, cookie `fyip_session` = raw id
  + HMAC signature (`FYIP_SESSION_SECRET`), 12h TTL, `HttpOnly`,
  `SameSite=lax`, `Secure` in production. Sessions are single-purpose and can be
  revoked in bulk (admin). Logout deletes the row + clears the cookie.
- RBAC: permission strings checked per-route via `requirePermission()`; role
  registry (`viewer|analyst|trader|admin`) is data, not code. Admin writes are
  audited.

`FYIP_SESSION_SECRET` is REQUIRED (≥16 chars) when `NODE_ENV=production` — the
server refuses to issue sessions without it (401/500 paths remain honest).

## Transport & headers

- HTTPS termination is expected in front of the app (reverse proxy example in
  README deployment notes); cookies are `Secure` in production.
- Next.js default security headers apply; add CSP once surface stabilizes —
  SSE requires `connect-src` to the terminal origin.

## Guest mode

`POST /api/v1/auth/guest` (used by the "Enter guest mode" button on `/login`)
issues a normal 12h session for a shared `guest@fyip.local` user holding the
**guest** role — read-only: `market.read`, `news.read`, `research.read`,
`analytics.read`, `portfolio.read`. Critically there are no write permissions
(alerts, workspaces, admin, bots, `news.save` bookmarking) and the account's
password is an unguessable random value (password login can never succeed). Each
guest login is audited. Operators can disable the endpoint entirely with
`FYIP_DISABLE_GUEST=true`.

## Bridge endpoint hardening

- `FYIP_BRIDGE_TOKEN` compared in constant time; ungated/unconfigured endpoint
  answers `503 BRIDGE_NOT_CONFIGURED` (ahead of 401 to avoid token probing).
- 2 MB / 5000-event ceilings per request; rejects malformed JSON, wrong
  schemaVersion, disallowed `dataStatus` — errors are summarized, never echoed.
- Bridge is **read-only market data**; there is no order/account surface to the
  desktop platform, and the Add-On runs without any broker-facing permissions.
- Audit entries record ingest outcomes + request IP (admin AUDIT page).

## FYP NEWS endpoints and content

- Feed endpoints come from the code registry, not from admin input. Collection
  enforces HTTPS, an exact-host allowlist, no URL credentials and a final-URL
  check after redirects; a redirect outside the allowlist fails closed.
- Only documented RSS/Atom/GDELT JSON feeds are collected. The server does not
  scrape HTML article pages or fetch full article bodies.
- `news.save` is a separate permission for per-user bookmarks (analyst, trader,
  admin). Guests do not have it; admin source/settings changes require
  `admin.providers`.
- Admin source updates are limited to enable/disable and intervals. Endpoints
  cannot be edited, which prevents SSRF and keeps licensing auditable.
- Source attribution and a license note are stored on every story. Headlines and
  provider summaries remain the publisher's content; operators are responsible
  for redistribution terms and should keep deployments personal unless cleared.
- Optional AI summarization requires an explicitly configured OpenAI-compatible
  endpoint and uses only provider-supplied summary text. It is labelled
  machine-generated and has a 15-second timeout.

## Personal-data footprint

Seeded demo personal data is limited to emails/usernames (+ audit trail).
Passwords are never logged; audit details carry no secrets.

## Licensing & data-redistribution notes (operator responsibility summary)

- Exchange market data (CME, etc.) is generally licensed per-user; routing it
  through the bridge to others requires the relevant redistribution
  entitlements. Set `dataStatus` truthfully in
  `bridge_options.json` and keep deployments personal unless cleared.
- Vendor news (NewsAPI, FinancialJuice, etc.) similarly carries per-subscriber
  terms; the news engine never intended to publicly re-post headlines —
  the assembly surfaces headlines with source label + time only.
- FYP NEWS only registers feeds whose public terms permit headline/link
  aggregation; attribution and license text stays attached to every story.
  Paywalled wires (Reuters, Bloomberg, FT, AP, ...) are deliberately absent.
- Options analytics are computed locally (`fyip_calculated`); Open Interest is
  reported with its publisher's entitlement string attached.
- Fixture data is synthetic, so it is labelled SIMULATED at the type level
  (`dataStatus="simulated"`, `entitlement="development-fixture"`, `is_fixture`
  columns) — stripping the label would require code changes, not config.
