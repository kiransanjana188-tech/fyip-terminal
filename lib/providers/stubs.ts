import type {
  EconomicDataProvider,
  EconomicSeriesPoint,
  MarketDataProvider,
  NewsProvider,
  NormalizedNewsItem,
  OptionContractQuote,
  OptionsDataProvider,
  ProviderCapabilities,
} from "./types";

/**
 * Declared-but-unconfigured vendor adapters.
 *
 * These adapters exist so the platform has a stable integration surface and the
 * Admin > Providers screen can report exactly what each vendor requires. They do
 * NOT invent endpoints or credentials, and they return an explicit UNAVAILABLE
 * result until the operator supplies real credentials and verifies the vendor's
 * current API. No vendor API responses are mocked here.
 */
class UnavailableError extends Error {
  constructor(provider: string, requirement: string) {
    super(`${provider} is not configured. Required: ${requirement}.`);
    this.name = "ProviderUnavailable";
  }
}

function externalCaps(entitlement: string, overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return {
    live: false,
    delayed: false,
    historical: false,
    depth: false,
    streaming: false,
    options: false,
    fundamentals: false,
    symbolSearch: false,
    entitlement,
    ...overrides,
  };
}

abstract class ExternalMarketProvider implements MarketDataProvider {
  readonly kind = "market_data" as const;
  constructor(
    readonly key: string,
    readonly label: string,
    private envVar: string,
    private caps: ProviderCapabilities,
  ) {}
  capabilities(): ProviderCapabilities {
    return this.caps;
  }
  isConfigured(): boolean {
    return typeof process.env[this.envVar] === "string" && process.env[this.envVar]!.length > 0;
  }
  start(): void {}
  stop(): void {}
  async fetchQuote(): Promise<null> {
    throw new UnavailableError(this.label, this.envVar);
  }
}

export class FinnhubProvider extends ExternalMarketProvider {
  constructor() {
    super("finnhub", "Finnhub", "FYIP_FINNHUB_API_KEY", externalCaps("vendor-subscription", { live: true, historical: true, symbolSearch: true }));
  }
}
export class AlphaVantageProvider extends ExternalMarketProvider {
  constructor() {
    super("alphavantage", "Alpha Vantage", "FYIP_ALPHAVANTAGE_API_KEY", externalCaps("vendor-subscription", { historical: true, delayed: true, fundamentals: true, symbolSearch: true }));
  }
}
export class PolygonProvider extends ExternalMarketProvider {
  constructor() {
    super("polygon", "Polygon.io", "FYIP_POLYGON_API_KEY", externalCaps("vendor-subscription", { live: true, historical: true, depth: true, options: true, symbolSearch: true }));
  }
}

export class FredEconomicProvider implements EconomicDataProvider {
  readonly kind = "economic" as const;
  readonly key = "fred";
  readonly label = "FRED (St. Louis Fed)";
  isConfigured(): boolean {
    return !!process.env.FYIP_FRED_API_KEY;
  }
  capabilities() {
    return { historical: true, live: false, entitlement: "public-api-key" };
  }
  async fetchSeries(): Promise<EconomicSeriesPoint[]> {
    throw new UnavailableError(this.label, "FYIP_FRED_API_KEY");
  }
}

export class NewsApiProvider implements NewsProvider {
  readonly kind = "news" as const;
  readonly key = "newsapi";
  readonly label = "NewsAPI (licensed)";
  isConfigured(): boolean {
    return !!process.env.FYIP_NEWSAPI_API_KEY;
  }
  capabilities() {
    return { live: false, historical: true, streaming: false, entitlement: "vendor-subscription" };
  }
  async fetchRecent(): Promise<NormalizedNewsItem[]> {
    throw new UnavailableError(this.label, "FYIP_NEWSAPI_API_KEY");
  }
}

export class FinancialJuiceProvider implements NewsProvider {
  readonly kind = "news" as const;
  readonly key = "financialjuice";
  readonly label = "FinancialJuice";
  isConfigured(): boolean {
    return !!(process.env.FYIP_FINANCIALJUICE_API_KEY || process.env.FYIP_FINANCIALJUICE_WS_URL);
  }
  capabilities() {
    return { live: true, historical: false, streaming: true, entitlement: "provider-authorization-required" };
  }
  async fetchRecent(): Promise<NormalizedNewsItem[]> {
    throw new UnavailableError(
      this.label,
      "an authorized FinancialJuice API key or embed token (FYIP_FINANCIALJUICE_API_KEY / FYIP_FINANCIALJUICE_WS_URL)",
    );
  }
}

export class SecEdgarProvider implements NewsProvider {
  readonly kind = "news" as const;
  readonly key = "sec";
  readonly label = "SEC EDGAR";
  isConfigured(): boolean {
    return true; // public data; network access still required at call time
  }
  capabilities() {
    return { live: false, historical: true, streaming: false, entitlement: "public" };
  }
  async fetchRecent(): Promise<NormalizedNewsItem[]> {
    throw new UnavailableError(this.label, "outbound network access to sec.gov (adapter declared, not enabled in this build)");
  }
}

export class PolygonOptionsProvider implements OptionsDataProvider {
  readonly kind = "options" as const;
  readonly key = "polygon";
  readonly label = "Polygon.io Options";
  isConfigured(): boolean {
    return !!process.env.FYIP_POLYGON_API_KEY;
  }
  capabilities() {
    return { live: true, historical: true, options: true, entitlement: "vendor-subscription (options plan)" };
  }
  async fetchChain(): Promise<OptionContractQuote[]> {
    throw new UnavailableError(this.label, "FYIP_POLYGON_API_KEY with an options-enabled plan");
  }
}