import type { NewsProviderDefinition, ParsedFeed } from "../types";
import { parseGdelt, parseSyndication } from "../parse";

/**
 * Provider registry.
 *
 * Only documented public feeds that were verified reachable and whose terms
 * allow headline/link aggregation are registered here. Paywalled wires
 * (Reuters, Bloomberg, FT, AP...) are deliberately absent because FYIP has no
 * redistribution licence. Adding a provider is a code change plus allowlist
 * review, not an arbitrary admin-entered URL.
 */

const USER_AGENT = "FYP NEWS/1.0 (+https://fyip.netlify.app; aggregator; admin@fyip.netlify.app)";
const ACCEPT_XML = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5";

export const NEWS_PROVIDERS: NewsProviderDefinition[] = [
  {
    key: "gdelt",
    name: "GDELT Project",
    kind: "aggregator",
    homepage: "https://www.gdeltproject.org/",
    endpoint:
      "https://api.gdeltproject.org/api/v2/doc/doc?query=%28economy%20OR%20markets%20OR%20inflation%20OR%20%22central%20bank%22%20OR%20earnings%20OR%20oil%20OR%20geopolitics%20OR%20tariff%20OR%20sanctions%29%20sourcelang%3Aenglish&mode=artlist&format=json&maxrecords=75&sort=datedesc&timespan=2d",
    format: "gdelt-json",
    intervalSeconds: 900,
    timeoutMs: 10_000,
    attribution: "Headline metadata via the GDELT Project; links to original publishers.",
    license: "GDELT DOC 2.0 API - free access with attribution; respect documented rate limits. Review GDELT terms before commercial redistribution.",
    regionHint: "global",
    categoryHint: null,
    official: false,
    enabledByDefault: true,
    headers: { Accept: "application/json" },
  },
  {
    key: "federalreserve",
    name: "Federal Reserve",
    kind: "central-bank",
    homepage: "https://www.federalreserve.gov/",
    endpoint: "https://www.federalreserve.gov/feeds/press_all.xml",
    format: "rss",
    intervalSeconds: 600,
    timeoutMs: 9_000,
    attribution: "Federal Reserve Board press releases.",
    license: "US federal government material; generally public domain. Federal Reserve seals/logos may be protected.",
    regionHint: "united-states",
    categoryHint: "central-banks",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "bls",
    name: "BLS",
    kind: "government",
    homepage: "https://www.bls.gov/",
    endpoint: "https://www.bls.gov/feed/bls_latest.rss",
    format: "rss",
    intervalSeconds: 900,
    timeoutMs: 9_000,
    attribution: "US Bureau of Labor Statistics latest releases.",
    license: "US federal government work; generally public domain. Attribution recommended.",
    regionHint: "united-states",
    categoryHint: "inflation-employment",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "bea",
    name: "BEA",
    kind: "government",
    homepage: "https://www.bea.gov/",
    endpoint: "https://apps.bea.gov/rss/rss.xml",
    format: "rss",
    intervalSeconds: 1800,
    timeoutMs: 10_000,
    attribution: "US Bureau of Economic Analysis news releases.",
    license: "US federal government work; generally public domain. Attribution recommended.",
    regionHint: "united-states",
    categoryHint: "macro",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "ecb",
    name: "European Central Bank",
    kind: "central-bank",
    homepage: "https://www.ecb.europa.eu/",
    endpoint: "https://www.ecb.europa.eu/rss/press.html",
    format: "rss",
    intervalSeconds: 900,
    timeoutMs: 10_000,
    attribution: "European Central Bank press releases.",
    license: "ECB website content, free access. Attribution required; check ECB copyright terms for redistribution.",
    regionHint: "europe",
    categoryHint: "central-banks",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "boe",
    name: "Bank of England",
    kind: "central-bank",
    homepage: "https://www.bankofengland.co.uk/",
    endpoint: "https://www.bankofengland.co.uk/rss/news",
    format: "rss",
    intervalSeconds: 900,
    timeoutMs: 10_000,
    attribution: "Bank of England news.",
    license: "Bank of England website terms apply; attribution required.",
    regionHint: "united-kingdom",
    categoryHint: "central-banks",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "boj",
    name: "Bank of Japan",
    kind: "central-bank",
    homepage: "https://www.boj.or.jp/en/",
    endpoint: "https://www.boj.or.jp/en/rss/whatsnew.xml",
    format: "rss",
    intervalSeconds: 1200,
    timeoutMs: 10_000,
    attribution: "Bank of Japan What's New (English).",
    license: "Bank of Japan website terms apply; attribution required.",
    regionHint: "japan",
    categoryHint: "central-banks",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "boc",
    name: "Bank of Canada",
    kind: "central-bank",
    homepage: "https://www.bankofcanada.ca/",
    endpoint: "https://www.bankofcanada.ca/content_type/press-releases/feed/",
    format: "rss",
    intervalSeconds: 1200,
    timeoutMs: 10_000,
    attribution: "Bank of Canada press releases.",
    license: "Bank of Canada website terms apply; attribution required.",
    regionHint: "canada",
    categoryHint: "central-banks",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "rba",
    name: "Reserve Bank of Australia",
    kind: "central-bank",
    homepage: "https://www.rba.gov.au/",
    endpoint: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml",
    format: "rss",
    intervalSeconds: 1800,
    timeoutMs: 10_000,
    attribution: "Reserve Bank of Australia media releases.",
    license: "RBA website terms apply; attribution required.",
    regionHint: "australia",
    categoryHint: "central-banks",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "sec",
    name: "SEC Press Releases",
    kind: "government",
    homepage: "https://www.sec.gov/newsroom",
    endpoint: "https://www.sec.gov/news/pressreleases.rss",
    format: "rss",
    intervalSeconds: 900,
    timeoutMs: 10_000,
    attribution: "US Securities and Exchange Commission press releases.",
    license: "US federal government material; generally public domain.",
    regionHint: "united-states",
    categoryHint: "regulation-trade",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "sec-8k",
    name: "SEC 8-K Filings",
    kind: "company",
    homepage: "https://www.sec.gov/edgar/search/",
    endpoint:
      "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&dateb=&owner=include&count=40&output=atom",
    format: "atom",
    intervalSeconds: 900,
    timeoutMs: 12_000,
    attribution: "Company 8-K filings hosted by SEC EDGAR. Filing claims are company statements, not FYIP verification.",
    license: "US federal government work (filings remain the filer's content). Attribution to SEC EDGAR required.",
    regionHint: "united-states",
    categoryHint: "company",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "eia",
    name: "US EIA",
    kind: "government",
    homepage: "https://www.eia.gov/",
    endpoint: "https://www.eia.gov/rss/todayinenergy.xml",
    format: "rss",
    intervalSeconds: 1800,
    timeoutMs: 10_000,
    attribution: "US Energy Information Administration Today in Energy.",
    license: "US federal government work; generally public domain.",
    regionHint: "united-states",
    categoryHint: "commodities",
    official: true,
    enabledByDefault: true,
  },
  {
    key: "treasury",
    name: "US Treasury",
    kind: "government",
    homepage: "https://home.treasury.gov/",
    endpoint: null,
    format: "rss",
    intervalSeconds: 1800,
    timeoutMs: 10_000,
    attribution: "US Department of the Treasury press releases (currently unavailable as a machine-readable feed).",
    license: "US federal government material; generally public domain.",
    regionHint: "united-states",
    categoryHint: "rates",
    official: true,
    enabledByDefault: false,
    unavailableReason: "No verified public RSS/Atom endpoint responded during setup. HTML pages are not scraped by this module.",
  },
  {
    key: "cftc",
    name: "CFTC",
    kind: "government",
    homepage: "https://www.cftc.gov/",
    endpoint: null,
    format: "rss",
    intervalSeconds: 1800,
    timeoutMs: 10_000,
    attribution: "US Commodity Futures Trading Commission press releases (currently unavailable as a machine-readable feed).",
    license: "US federal government material; generally public domain.",
    regionHint: "united-states",
    categoryHint: "regulation-trade",
    official: true,
    enabledByDefault: false,
    unavailableReason: "No verified public RSS/Atom endpoint responded during setup. HTML pages are not scraped by this module.",
  },
];

export const NEWS_PROVIDER_MAP: Map<string, NewsProviderDefinition> = new Map(
  NEWS_PROVIDERS.map((provider) => [provider.key, provider]),
);

/** Hosts the server is allowed to contact for news collection. */
export const NEWS_ENDPOINT_ALLOWLIST: string[] = [
  "api.gdeltproject.org",
  "www.federalreserve.gov",
  "www.bls.gov",
  "apps.bea.gov",
  "www.ecb.europa.eu",
  "www.bankofengland.co.uk",
  "www.boj.or.jp",
  "www.bankofcanada.ca",
  "www.rba.gov.au",
  "www.sec.gov",
  "www.eia.gov",
];

export function isNewsProviderKey(value: string): boolean {
  return NEWS_PROVIDER_MAP.has(value);
}

export function getNewsProvider(key: string): NewsProviderDefinition | null {
  return NEWS_PROVIDER_MAP.get(key) ?? null;
}

/**
 * SSRF guard: HTTPS only, exact host allowlist, no credentials, no fragments.
 * Providers are code-defined; admins cannot edit endpoints.
 */
export function isAllowedNewsEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  return NEWS_ENDPOINT_ALLOWLIST.includes(url.hostname.toLowerCase());
}

export function parseProviderFeed(
  provider: NewsProviderDefinition,
  body: string,
  now = Date.now(),
): ParsedFeed {
  if (!provider.endpoint || !isAllowedNewsEndpoint(provider.endpoint)) {
    throw new Error(`Endpoint for ${provider.key} is not allowlisted`);
  }
  if (provider.format === "gdelt-json") return parseGdelt(body, now);
  return parseSyndication(body, provider.homepage, now);
}

export function providerRequestHeaders(provider: NewsProviderDefinition): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: provider.format === "gdelt-json" ? "application/json" : ACCEPT_XML,
    "Accept-Language": "en-US,en;q=0.8",
    ...provider.headers,
  };
}
