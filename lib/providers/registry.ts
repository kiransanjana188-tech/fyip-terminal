import { quoteHub } from "@/lib/market/hub";
import { DevelopmentFixtureProvider } from "./development-fixtures";
import { NinjaTraderBridgeProvider } from "./ninjatrader-bridge";
import { NinjaTraderOptionsProvider } from "./ninjatrader-options";
import { FixtureOptionsProvider } from "./options-fixtures";
import {
  AlphaVantageProvider,
  FinancialJuiceProvider,
  FinnhubProvider,
  FredEconomicProvider,
  NewsApiProvider,
  PolygonOptionsProvider,
  PolygonProvider,
  SecEdgarProvider,
} from "./stubs";
import type {
  EconomicDataProvider,
  MarketDataProvider,
  NewsProvider,
  OptionsDataProvider,
  ProviderCapabilities,
  ProviderSummary,
} from "./types";

const marketData: MarketDataProvider[] = [
  new NinjaTraderBridgeProvider(),
  new DevelopmentFixtureProvider(),
  new FinnhubProvider(),
  new AlphaVantageProvider(),
  new PolygonProvider(),
];

const news: NewsProvider[] = [
  new FinancialJuiceProvider(),
  new NewsApiProvider(),
  new SecEdgarProvider(),
];

const economic: EconomicDataProvider[] = [new FredEconomicProvider()];
const options: OptionsDataProvider[] = [
  new NinjaTraderOptionsProvider(),
  new FixtureOptionsProvider(),
  new PolygonOptionsProvider(),
];

let started = false;

/**
 * Boot configured streaming providers exactly once and pipe them into the hub.
 * Request/response vendors are pulled on demand, not started here.
 */
export function ensureProvidersStarted(): void {
  if (started) return;
  started = true;
  for (const p of marketData) {
    if (!p.isConfigured()) continue;
    try {
      p.start((q) => quoteHub.ingest(q));
    } catch (err) {
      console.error(`[fyip:provider] failed to start ${p.key}:`, (err as Error).message);
    }
  }
}

export function getMarketProvider(key: string): MarketDataProvider | undefined {
  return marketData.find((p) => p.key === key);
}

export function getNewsProvider(key: string): NewsProvider | undefined {
  return news.find((p) => p.key === key);
}

export function getEconomicProvider(key: string): EconomicDataProvider | undefined {
  return economic.find((p) => p.key === key);
}

export function getOptionsProvider(key: string): OptionsDataProvider | undefined {
  return options.find((p) => p.key === key);
}

export function listOptionsProviders(): readonly OptionsDataProvider[] {
  return options;
}

/** Fill partial capability declarations from non-market providers. */
function asCaps(partial: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    live: false, delayed: false, historical: false, depth: false, streaming: false,
    options: false, fundamentals: false, symbolSearch: false, entitlement: "unspecified",
    ...partial,
  };
}

function blockerFor(key: string, configured: boolean): string | null {
  if (configured) return null;
  switch (key) {
    case "ninjatrader":
      return "Set FYIP_BRIDGE_TOKEN and install the NinjaTrader 8 Add-On (see docs/NINJATRADER_BRIDGE.md).";
    case "ninjatrader_options":
      return "Set FYIP_BRIDGE_TOKEN and enable the NinjaTrader CME option channel (optionsMap in fyip_bridge_options.json).";
    case "fixture":
      return "Set FYIP_ENABLE_FIXTURES=true to enable clearly-labelled SIMULATED data for development.";
    case "fixture_options":
      return "Set FYIP_ENABLE_FIXTURES=true to enable clearly-labelled SIMULATED options chains for development.";
    case "finnhub":
      return "Set FYIP_FINNHUB_API_KEY.";
    case "alphavantage":
      return "Set FYIP_ALPHAVANTAGE_API_KEY.";
    case "polygon":
      return "Set FYIP_POLYGON_API_KEY (options/depth require a suitable plan).";
    case "fred":
      return "Set FYIP_FRED_API_KEY.";
    case "financialjuice":
      return "Requires an authorized FinancialJuice API/embed entitlement.";
    case "newsapi":
      return "Set FYIP_NEWSAPI_API_KEY.";
    case "sec":
      return "Public adapter declared; outbound network access not enabled in this build.";
    default:
      return "Not configured.";
  }
}

export function providerSummaries(): ProviderSummary[] {
  const out: ProviderSummary[] = [];
  for (const p of marketData) {
    out.push({ key: p.key, kind: p.kind, label: p.label, configured: p.isConfigured(), capabilities: p.capabilities(), blocker: blockerFor(p.key, p.isConfigured()) });
  }
  for (const p of news) {
    out.push({ key: p.key, kind: p.kind, label: p.label, configured: p.isConfigured(), capabilities: asCaps(p.capabilities()), blocker: blockerFor(p.key, p.isConfigured()) });
  }
  for (const p of economic) {
    out.push({ key: p.key, kind: p.kind, label: p.label, configured: p.isConfigured(), capabilities: asCaps(p.capabilities()), blocker: blockerFor(p.key, p.isConfigured()) });
  }
  for (const p of options) {
    out.push({ key: p.key, kind: p.kind, label: p.label, configured: p.isConfigured(), capabilities: asCaps(p.capabilities()), blocker: blockerFor(p.key, p.isConfigured()) });
  }
  return out;
}