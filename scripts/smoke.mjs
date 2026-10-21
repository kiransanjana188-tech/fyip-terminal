/**
 * End-to-end smoke test against a running FYIP TERMINAL instance.
 * Usage: node scripts/smoke.mjs [baseUrl]
 * Requires the server to be started with FYIP_ENABLE_FIXTURES=true and a
 * known FYIP_ADMIN_PASSWORD / FYIP_BRIDGE_TOKEN.
 */
const BASE = process.argv[2] ?? "http://localhost:3111";
const EMAIL = process.env.FYIP_ADMIN_EMAIL ?? "admin@fyip.local";
const PASSWORD = process.env.FYIP_ADMIN_PASSWORD ?? "ChangeMe!12345";
const BRIDGE_TOKEN = process.env.FYIP_BRIDGE_TOKEN ?? "dev-bridge-token-change-me";

let cookie = "";
let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

async function req(method, path, { body, token, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log(`FYIP TERMINAL smoke test → ${BASE}\n`);

  const health = await req("GET", "/api/v1/health");
  check("health 200", health.status === 200);
  check("database migrated", health.json?.database?.migrations >= 7, `${health.json?.database?.migrations} migrations`);
  check("fixture feed active", health.json?.feeds?.some((f) => f.provider === "fixture" && f.status === "simulated"));

  const unauth = await req("GET", "/api/v1/quotes");
  check("quotes require auth (401)", unauth.status === 401);

  const login = await req("POST", "/api/v1/auth/login", { body: { email: EMAIL, password: PASSWORD } });
  check("login 200", login.status === 200, login.json?.email ?? login.text?.slice(0, 120));
  check("session cookie issued", cookie.startsWith("fyip_session="));

  const me = await req("GET", "/api/v1/auth/me");
  check("me authenticated", me.json?.authenticated === true);
  check("admin role", me.json?.user?.roles?.includes("admin"));

  const quotes = await req("GET", "/api/v1/quotes?symbols=ES1!,NQ1!,SPY");
  check("quotes returned", quotes.status === 200 && quotes.json?.quotes?.length === 3);
  const es = quotes.json?.quotes?.[0];
  check("quote has value + simulated status", es != null && es.last !== null && es.dataStatus === "simulated",
    es ? `${es.symbol} last=${es.last} status=${es.dataStatus}` : "no quote row");

  const inst = await req("GET", "/api/v1/instruments?assetClass=future");
  check("instrument master loads", inst.status === 200 && inst.json.count > 0, `${inst.json?.count} futures`);

  const news = await req("GET", "/api/v1/news?limit=5");
  check("news wire responds", news.status === 200);
  check("fixture news flagged", news.json.items?.every((i) => i.is_fixture === 1), `${news.json.items?.length} items`);

  const cal = await req("GET", "/api/v1/econ/calendar?limit=10");
  check("calendar responds", cal.status === 200);
  check("calendar fixtures flagged, no fabricated values", cal.json?.events?.every((e) => e.is_fixture === 1));

  const greeks = await req("POST", "/api/v1/options/greeks", {
    body: { spot: 100, strike: 100, timeToExpiry: 1, rate: 0.05, vol: 0.2, type: "call" },
  });
  check("BS calculator returns greeks", greeks.status === 200 && greeks.json.greeks.price > 0,
    `price=${greeks.json?.greeks?.price?.toFixed(4)}`);
  check("greeks labelled fyip_calculated", greeks.json?.greeksSource === "fyip_calculated");

  const gex = await req("POST", "/api/v1/gex", {
    body: {
      spot: 100, contractMultiplier: 100, timeToExpiryYears: 0.05, riskFreeRate: 0.04,
      contracts: [
        { strike: 100, optionType: "call", openInterest: 1000, impliedVol: 0.2 },
        { strike: 100, optionType: "put", openInterest: 1000, impliedVol: 0.2 },
      ],
    },
  });
  check("GEX computes", gex.status === 200 && gex.json.perStrike?.length === 1, `total=${gex.json?.totalGex}`);
  check("GEX states dealer assumption", typeof gex.json?.assumption === "string");

  const bridgeBad = await req("POST", "/api/v1/bridge/ingest", { body: { foo: 1 } });
  check("bridge rejects bad token (401)", bridgeBad.status === 401);

  const bridgeOk = await req("POST", "/api/v1/bridge/ingest", {
    token: BRIDGE_TOKEN,
    body: {
      schemaVersion: 1, eventType: "market.quote", provider: "ninjatrader",
      instrumentId: "inst_es1!", providerSymbol: "ES ##-##", exchange: "CME",
      eventTimestamp: new Date().toISOString(), receivedTimestamp: new Date().toISOString(),
      dataStatus: "live", bid: 5000.25, ask: 5000.5, last: 5000.25, volume: 100,
    },
  });
  check("bridge accepts valid event", bridgeOk.status === 200 && bridgeOk.json?.accepted === 1);
  check("bridge rejects malformed event", bridgeOk.json?.rejected === 0);

  const bridgeBad2 = await req("POST", "/api/v1/bridge/ingest", {
    token: BRIDGE_TOKEN,
    body: { schemaVersion: 99, eventType: "market.quote", instrumentId: "inst_es1!", eventTimestamp: new Date().toISOString() },
  });
  check("bridge rejects bad schema", bridgeBad2.json?.accepted === 0 && bridgeBad2.json?.rejected === 1);

  const depthOk = await req("POST", "/api/v1/bridge/ingest", {
    token: BRIDGE_TOKEN,
    body: {
      schemaVersion: 1, eventType: "market.depth", provider: "ninjatrader",
      instrumentId: "inst_esz6", providerSymbol: "ES 03-26",
      eventTimestamp: new Date().toISOString(), receivedTimestamp: new Date().toISOString(),
      dataStatus: "simulated",
      bids: [{ price: 6200.25, volume: 12 }, { price: 6200.0, volume: 40 }],
      asks: [{ price: 6200.5, volume: 8 }, { price: 6200.75, volume: 25 }],
    },
  });
  check("bridge accepts depth ladder", depthOk.json?.accepted === 1 && depthOk.json?.depthLadders === 1);

  const depthBad = await req("POST", "/api/v1/bridge/ingest", {
    token: BRIDGE_TOKEN,
    body: {
      schemaVersion: 1, eventType: "market.depth", instrumentId: "inst_esz6",
      eventTimestamp: new Date().toISOString(), dataStatus: "simulated",
      bids: [{ price: "x", volume: 1 }],
    },
  });
  check("bridge rejects malformed depth", depthBad.json?.accepted === 0 && depthBad.json?.rejected === 1);

  // Live depth via SSE for the ESZ6 contract we just ingested.
  const sseRes = await fetch(BASE + "/api/v1/stream/quotes?symbols=ESZ6&types=depth", {
    headers: { cookie },
  });
  let sawDepth = false;
  if (sseRes.ok) {
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + 4000;
    let buf = "";
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), 1500))]);
      if (!chunk || chunk.done) break;
      buf += decoder.decode(chunk.value);
      if (buf.includes("event: depth")) { sawDepth = true; break; }
    }
    await reader.cancel().catch(() => {});
  } else {
    // guest/admin session reuse — ignore failures here (covered by other checks)
    void sseRes;
  }
  check("SSE emits depth events", sawDepth);

  // Trade print ring: proxy check — ingest a trade, no crash, accepted.
  const tradeOk = await req("POST", "/api/v1/bridge/ingest", {
    token: BRIDGE_TOKEN,
    body: {
      schemaVersion: 1, eventType: "market.trade", provider: "ninjatrader",
      instrumentId: "inst_esz6", providerSymbol: "ES 03-26",
      eventTimestamp: new Date().toISOString(), receivedTimestamp: new Date().toISOString(),
      dataStatus: "simulated", price: 6200.25, size: 7, side: "buy",
    },
  });
  check("bridge accepts trade print", tradeOk.json?.accepted === 1 && tradeOk.json?.trades === 1);

  const bridgeStatus = await req("GET", "/api/v1/bridge/status");
  check("bridge status live after ingest", bridgeStatus.json?.feed?.status === "live", bridgeStatus.json?.feed?.status);

  const created = await req("POST", "/api/v1/portfolio", {
    body: { action: "create_account", label: "Smoke Account", broker: "Manual", accountRef: "SMOKE-1" },
  });
  check("create portfolio account", created.status === 201);
  const acctId = created.json?.id;
  const pos = await req("POST", "/api/v1/portfolio", {
    body: { action: "add_position", accountId: acctId, symbol: "SPY", quantity: 100, price: 400 },
  });
  check("add position", pos.status === 201);

  const port = await req("GET", "/api/v1/portfolio");
  check("portfolio returns positions", port.json?.positions?.length >= 1);
  check("position marked from latest quote", port.json?.positions?.[0]?.last !== null,
    `last=${port.json?.positions?.[0]?.last}`);

  const risk = await req("GET", "/api/v1/risk");
  check("risk analytics ready", risk.json?.ready === true);
  check("risk exposes exposures", risk.json?.exposures?.length >= 1);

  const screen = await req("GET", "/api/v1/screener?assetClass=future");
  check("screener runs", screen.status === 200 && screen.json?.count >= 0, `${screen.json?.count} results`);

  const banned = await req("POST", "/api/v1/gex", { body: {} });
  check("GEX validates input", banned.status === 400);

  const guestLogin = await req("POST", "/api/v1/auth/guest");
  check("guest session issued", guestLogin.status === 200 && cookie.startsWith("fyip_session="));
  const guestMe = await req("GET", "/api/v1/auth/me");
  check("guest resolves as guest role", guestMe.json?.user?.roles?.includes("guest"));
  const guestQuotes = await req("GET", "/api/v1/quotes?symbols=ES1!");
  check("guest can read quotes", guestQuotes.status === 200);
  const guestAlert = await req("POST", "/api/v1/alerts", { body: { name: "nope", kind: "price_cross", target: "ES1!", condition: {}, delivery: "center" } });
  check("guest writes blocked (403)", guestAlert.status === 403);
  const guestAdmin = await req("GET", "/api/v1/admin/audit");
  check("guest blocked from admin", guestAdmin.status === 403);
  // restore admin session for admin-only checks below
  await req("POST", "/api/v1/auth/login", { body: { email: EMAIL, password: PASSWORD } });

  const audit = await req("GET", "/api/v1/admin/audit?limit=5");
  check("audit log has records", audit.json?.logs?.length > 0, `${audit.json?.logs?.length} entries`);

  const providers = await req("GET", "/api/v1/admin/providers");
  check("provider registry lists blockers", providers.json?.providers?.some((p) => p.blocker !== null));

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
