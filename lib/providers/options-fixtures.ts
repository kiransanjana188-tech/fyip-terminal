import type { OptionContractQuote, OptionsDataProvider, ProviderCapabilities } from "./types";

/**
 * DEVELOPMENT OPTIONS FIXTURES — synthetic chains, gated by FYIP_ENABLE_FIXTURES.
 * Every chain is deterministic for a given date/symbol and must be labelled
 * SIMULATED. It exists so the GEX workspaces can be exercised end-to-end without
 * a licensed options feed; it is never a substitute for market data.
 */

interface FixtureSymbol {
  symbol: string;
  spot: number;
  strikeStep: number;
  baseVol: number;
  oiBase: number;
}

const SYMBOLS: FixtureSymbol[] = [
  { symbol: "SPY", spot: 675, strikeStep: 2.5, baseVol: 0.16, oiBase: 5200 },
  { symbol: "QQQ", spot: 615, strikeStep: 2.5, baseVol: 0.2, oiBase: 4300 },
  { symbol: "SPX", spot: 6780, strikeStep: 25, baseVol: 0.14, oiBase: 3600 },
  { symbol: "NDX", spot: 22650, strikeStep: 50, baseVol: 0.18, oiBase: 2400 },
  { symbol: "ES", spot: 6800, strikeStep: 10, baseVol: 0.15, oiBase: 3100 },
  { symbol: "NQ", spot: 22750, strikeStep: 25, baseVol: 0.19, oiBase: 2100 },
];

const SYMBOL_BY_NAME = new Map(SYMBOLS.map((s) => [s.symbol, s]));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nextFridays(from: Date, count: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7));
  while (out.length < count) {
    const dte = Math.round((d.getTime() - from.getTime()) / 86_400_000);
    if (dte >= 2) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export function fixtureOptionsSymbols(): string[] {
  return SYMBOLS.map((s) => s.symbol);
}

export class FixtureOptionsProvider implements OptionsDataProvider {
  readonly kind = "options" as const;
  readonly key = "fixture_options";
  readonly label = "FYIP Options Fixtures (SIMULATED)";

  isConfigured(): boolean {
    return process.env.FYIP_ENABLE_FIXTURES === "true";
  }

  capabilities(): Pick<ProviderCapabilities, "live" | "historical" | "options" | "entitlement"> {
    return { live: false, historical: false, options: true, entitlement: "development-fixture" };
  }

  supportedSymbols(): readonly string[] {
    return fixtureOptionsSymbols();
  }

  async fetchChain(underlyingId: string): Promise<OptionContractQuote[]> {
    if (!this.isConfigured()) throw new Error("Options fixtures are disabled. Set FYIP_ENABLE_FIXTURES=true.");
    const symbol = underlyingId.replace(/^inst_/, "").toUpperCase();
    const cfg = SYMBOL_BY_NAME.get(symbol);
    if (!cfg) throw new Error(`No options fixture for ${underlyingId}.`);

    const now = new Date();
    const asOf = now.toISOString();
    const expirations = nextFridays(now, 6);
    const rng = mulberry32(hashString(symbol) ^ now.getUTCDate());
    const contracts: OptionContractQuote[] = [];
    const strikeCount = 41;
    const firstStrike = cfg.spot - Math.floor(strikeCount / 2) * cfg.strikeStep;

    for (let e = 0; e < expirations.length; e++) {
      const expiration = expirations[e];
      const dte = Math.max(
        1,
        Math.round((Date.parse(`${expiration}T20:00:00Z`) - now.getTime()) / 86_400_000),
      );
      const termPremium = 0.012 * Math.sqrt(dte / 30);
      for (let i = 0; i < strikeCount; i++) {
        const strike = Math.round((firstStrike + i * cfg.strikeStep) * 100) / 100;
        const moneyness = Math.abs(strike - cfg.spot) / cfg.spot;
        const smile = 0.55 * Math.pow(moneyness, 1.25);
        const iv = Math.min(1.2, cfg.baseVol + smile + termPremium);

        for (const optionType of ["call", "put"] as const) {
          const wing = Math.exp(-Math.abs(strike - cfg.spot) / (cfg.spot * 0.032));
          const sideFactor =
            optionType === "call"
              ? strike >= cfg.spot ? 1.45 : 0.72
              : strike <= cfg.spot ? 1.5 : 0.72;
          const roundSpike = Math.abs(strike - Math.round(cfg.spot)) < cfg.strikeStep / 2 ? 1.9 : 1;
          const decay = 1 / (1 + e * 0.18);
          const noise = 0.72 + rng() * 0.56;
          const openInterest = Math.round(
            (cfg.oiBase * wing * sideFactor * roundSpike * decay * noise) / 10,
          ) * 10;

          contracts.push({
            expiration,
            strike,
            optionType,
            bid: null,
            ask: null,
            last: null,
            volume: null,
            openInterest,
            impliedVol: iv,
            greeksSource: "fyip_calculated",
            gamma: null,
            underlyingPrice: cfg.spot,
            asOf,
          });
        }
      }
    }
    return contracts;
  }
}
