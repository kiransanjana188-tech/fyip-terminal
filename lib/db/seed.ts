import { execute, newId, queryOne } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ROLE_DEFINITIONS } from "@/lib/auth/rbac";
import { seedInstrumentMaster } from "@/lib/market/instruments";
import { seedFixtureNews } from "@/lib/news/engine";

/**
 * Idempotent bootstrap data. Runs once per process via ensureSeeded().
 * Contains NO invented live values: fixtures are explicitly labelled and
 * economic placeholders carry null actual/consensus.
 */
let seeded = false;

export function ensureSeeded(): void {
  if (seeded) return;
  seedRoles();
  seedInstrumentMaster();
  seedAdmin();
  seedProviders();
  seedNewsSources();
  seedCompanyProfiles();
  if (process.env.FYIP_ENABLE_FIXTURES === "true") {
    seedEconomicFixtures();
    seedFixtureNews();
  }
  seeded = true;
}

function seedRoles(): void {
  for (const [key, def] of Object.entries(ROLE_DEFINITIONS)) {
    execute(
      `INSERT INTO roles (id, key, name, description) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET name=excluded.name, description=excluded.description`,
      `role_${key}`, key, def.name, def.description,
    );
  }
}

function seedAdmin(): void {
  const email = process.env.FYIP_ADMIN_EMAIL ?? "admin@fyip.local";
  const existing = queryOne<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
  if (existing) return;
  const password = process.env.FYIP_ADMIN_PASSWORD ?? "ChangeMe!12345";
  const id = newId("usr");
  const now = new Date().toISOString();
  execute(
    `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    id, email, "FYIP Administrator", hashPassword(password), now, now,
  );
  execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')", id);
}

interface ProviderSeedRow {
  key: string;
  kind: string;
  enabled: boolean;
  entitlement: string;
  notes: string;
}

const PROVIDERS: ProviderSeedRow[] = [
  { key: "fixture", kind: "market_data", enabled: false, entitlement: "development-fixture", notes: "Deterministic SIMULATED feed for development. Enable with FYIP_ENABLE_FIXTURES=true. Never shown as live." },
  { key: "ninjatrader", kind: "market_data", enabled: false, entitlement: "exchange-entitlement-required", notes: "Receives normalized events from the NinjaTrader 8 Add-On bridge via POST /api/v1/bridge/ingest." },
  { key: "finnhub", kind: "market_data", enabled: false, entitlement: "vendor-subscription", notes: "Set FYIP_FINNHUB_API_KEY. Adapter declared; live fetch not enabled in this build." },
  { key: "alphavantage", kind: "market_data", enabled: false, entitlement: "vendor-subscription", notes: "Set FYIP_ALPHAVANTAGE_API_KEY. Adapter declared; not enabled in this build." },
  { key: "polygon", kind: "market_data", enabled: false, entitlement: "vendor-subscription", notes: "Set FYIP_POLYGON_API_KEY. Options/depth require the relevant plan." },
  { key: "fred", kind: "economic", enabled: false, entitlement: "public-api-key", notes: "Set FYIP_FRED_API_KEY for official macro series." },
  { key: "financialjuice", kind: "news", enabled: false, entitlement: "provider-authorization-required", notes: "Only enable with an authorized FinancialJuice API/embed entitlement. No scraping is implemented." },
  { key: "newsapi", kind: "news", enabled: false, entitlement: "vendor-subscription", notes: "Set FYIP_NEWSAPI_API_KEY for licensed wire headlines." },
  { key: "sec", kind: "news", enabled: false, entitlement: "public", notes: "Official SEC EDGAR filings/announcements adapter (public)." },
  { key: "official", kind: "news", enabled: false, entitlement: "public", notes: "Official central-bank / government release adapters." },
];

function seedProviders(): void {
  const now = new Date().toISOString();
  for (const p of PROVIDERS) {
    execute(
      `INSERT INTO data_provider_configs (id, provider_key, kind, enabled, entitlement, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_key) DO UPDATE SET kind=excluded.kind, entitlement=excluded.entitlement, notes=excluded.notes`,
      `prov_${p.key}`, p.key, p.kind, p.enabled ? 1 : 0, p.entitlement, p.notes, now,
    );
  }
}

const NEWS_SOURCES: { key: string; name: string; kind: string; homepage: string; licensed: boolean; enabled: boolean; notes: string }[] = [
  { key: "financialjuice", name: "FinancialJuice", kind: "squawk", homepage: "https://www.financialjuice.com", licensed: true, enabled: false, notes: "Requires an authorized API/embed entitlement. Credentials kept server-side." },
  { key: "fixture", name: "FYIP Development Fixture Wire", kind: "fixture", homepage: "", licensed: false, enabled: false, notes: "Clearly-labelled synthetic headlines for UI development only. Never marked breaking unless it is a fixture rule." },
  { key: "sec", name: "SEC EDGAR", kind: "official", homepage: "https://www.sec.gov/edgar", licensed: false, enabled: false, notes: "Public filings and company announcements." },
  { key: "federalreserve", name: "Federal Reserve", kind: "official", homepage: "https://www.federalreserve.gov", licensed: false, enabled: false, notes: "Official monetary-policy statements and speeches." },
  { key: "ecb", name: "European Central Bank", kind: "official", homepage: "https://www.ecb.europa.eu", licensed: false, enabled: false, notes: "Official ECB releases." },
  { key: "reuters", name: "Reuters", kind: "vendor", homepage: "https://www.reuters.com", licensed: true, enabled: false, notes: "Requires a licensed feed/API agreement." },
];

function seedNewsSources(): void {
  for (const s of NEWS_SOURCES) {
    execute(
      `INSERT INTO news_sources (id, key, name, kind, homepage, licensed, enabled, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET name=excluded.name, kind=excluded.kind, homepage=excluded.homepage,
         licensed=excluded.licensed, notes=excluded.notes`,
      `src_${s.key}`, s.key, s.name, s.kind, s.homepage, s.licensed ? 1 : 0, s.enabled ? 1 : 0, s.notes,
    );
  }
}

/**
 * Reference metadata only (sector/industry classification is public, stable
 * information). This is NOT financial statement data — statements require a
 * fundamentals provider and are intentionally absent.
 */
const COMPANY_PROFILES: { symbol: string; sector: string; industry: string; country: string }[] = [
  { symbol: "AAPL", sector: "Information Technology", industry: "Technology Hardware", country: "US" },
  { symbol: "MSFT", sector: "Information Technology", industry: "Software", country: "US" },
  { symbol: "NVDA", sector: "Information Technology", industry: "Semiconductors", country: "US" },
  { symbol: "AMZN", sector: "Consumer Discretionary", industry: "Broadline Retail", country: "US" },
  { symbol: "GOOGL", sector: "Communication Services", industry: "Interactive Media", country: "US" },
  { symbol: "META", sector: "Communication Services", industry: "Interactive Media", country: "US" },
  { symbol: "TSLA", sector: "Consumer Discretionary", industry: "Automobiles", country: "US" },
  { symbol: "JPM", sector: "Financials", industry: "Diversified Banks", country: "US" },
  { symbol: "BAC", sector: "Financials", industry: "Diversified Banks", country: "US" },
  { symbol: "GS", sector: "Financials", industry: "Capital Markets", country: "US" },
  { symbol: "XOM", sector: "Energy", industry: "Integrated Oil & Gas", country: "US" },
];

function seedCompanyProfiles(): void {
  const now = new Date().toISOString();
  for (const p of COMPANY_PROFILES) {
    const inst = queryOne<{ id: string; display_name: string }>(
      "SELECT id, display_name FROM instruments WHERE symbol = ?",
      p.symbol,
    );
    if (!inst) continue;
    execute(
      `INSERT INTO company_profiles (instrument_id, legal_name, sector, industry, country, employees, description, cik, fiscal_year_end, source, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 'fyip-reference-metadata', ?)
       ON CONFLICT(instrument_id) DO NOTHING`,
      inst.id, inst.display_name, p.sector, p.industry, p.country, now,
    );
  }
}

/**
 * Development-only scheduled-event placeholders. `is_fixture = 1`, source
 * explicitly "fyip-development-fixture", and actual/consensus are NULL. These
 * exist purely to exercise the calendar UI and must never be read as real data.
 */
function seedEconomicFixtures(): void {
  const count = queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM economic_events WHERE is_fixture = 1");
  if ((count?.c ?? 0) > 0) return;
  const now = new Date();
  const events: { country: string; indicator: string; importance: string; offsetDays: number; unit: string }[] = [
    { country: "US", indicator: "CPI (YoY)", importance: "high", offsetDays: 2, unit: "%" },
    { country: "US", indicator: "Core CPI (MoM)", importance: "high", offsetDays: 2, unit: "%" },
    { country: "US", indicator: "Nonfarm Payrolls", importance: "high", offsetDays: 5, unit: "k" },
    { country: "US", indicator: "Initial Jobless Claims", importance: "medium", offsetDays: 1, unit: "k" },
    { country: "US", indicator: "FOMC Rate Decision", importance: "high", offsetDays: 9, unit: "upper bound %" },
    { country: "EU", indicator: "ECB Main Refinancing Rate", importance: "high", offsetDays: 12, unit: "%" },
    { country: "US", indicator: "ISM Manufacturing PMI", importance: "medium", offsetDays: 3, unit: "index" },
    { country: "US", indicator: "Retail Sales (MoM)", importance: "medium", offsetDays: 7, unit: "%" },
  ];
  for (const e of events) {
    const at = new Date(now.getTime() + e.offsetDays * 86400_000);
    at.setUTCHours(13, 30, 0, 0);
    execute(
      `INSERT INTO economic_events (id, country, indicator, importance, scheduled_at, timezone, unit,
        source, source_url, status, is_fixture, created_at)
       VALUES (?, ?, ?, ?, ?, 'UTC', ?, 'fyip-development-fixture', NULL, 'scheduled', 1, ?)`,
      newId("econ"), e.country, e.indicator, e.importance, at.toISOString(), e.unit, now.toISOString(),
    );
  }
}