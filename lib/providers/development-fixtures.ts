import { listInstruments } from "@/lib/market/instruments";
import type { MarketDataProvider, NormalizedQuote, ProviderCapabilities } from "./types";

/**
 * DEVELOPMENT FIXTURE PROVIDER — synthetic data only.
 *
 * Emits a deterministic pseudo-random walk so the workstation can be exercised
 * without a live feed. Every quote is stamped `dataStatus: "simulated"` and the
 * UI renders a SIMULATED badge. This provider is DISABLED unless
 * FYIP_ENABLE_FIXTURES=true and must never be presented as live market data.
 */
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

function hashSymbol(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface FixtureState {
  base: number;
  last: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  rand: () => number;
}

export class DevelopmentFixtureProvider implements MarketDataProvider {
  readonly key = "fixture";
  readonly kind = "market_data" as const;
  readonly label = "FYIP Development Fixtures (SIMULATED)";
  private timer: ReturnType<typeof setInterval> | null = null;
  private state = new Map<string, FixtureState>();

  capabilities(): ProviderCapabilities {
    return {
      live: false,
      delayed: false,
      historical: false,
      depth: false,
      streaming: true,
      options: false,
      fundamentals: false,
      symbolSearch: true,
      entitlement: "development-fixture",
    };
  }

  isConfigured(): boolean {
    return process.env.FYIP_ENABLE_FIXTURES === "true";
  }

  private initState(): void {
    if (this.state.size > 0) return;
    for (const inst of listInstruments()) {
      if (inst.asset_class === "continuous_future") continue;
      const rand = mulberry32(hashSymbol(inst.symbol));
      // Baseline magnitudes are synthetic anchors, not market levels.
      const base =
        inst.asset_class === "fx" ? 1 + rand() : inst.asset_class === "rate" ? 3 + rand() * 2 :
        inst.asset_class === "crypto" ? 100 + rand() * 40000 :
        inst.asset_class === "equity" ? 20 + rand() * 400 : 100 + rand() * 4000;
      const scale = 10 ** inst.price_scale;
      const b = Math.round(base * scale) / scale;
      this.state.set(inst.id, {
        base: b, last: b, prevClose: b, open: b, high: b, low: b, volume: 0, rand,
      });
    }
  }

  start(sink: (quote: NormalizedQuote) => void): void {
    if (!this.isConfigured()) return;
    this.initState();
    const emit = () => {
      const nowIso = new Date().toISOString();
      for (const inst of listInstruments()) {
        const st = this.state.get(inst.id);
        if (!st) continue;
        const scale = 10 ** inst.price_scale;
        const drift = (st.rand() - 0.5) * st.base * 0.0025;
        st.last = Math.max(inst.tick_size, Math.round((st.last + drift) * scale) / scale);
        st.high = Math.max(st.high, st.last);
        st.low = st.low === st.base ? st.last : Math.min(st.low, st.last);
        const spread = inst.tick_size * (1 + Math.floor(st.rand() * 3));
        st.volume += Math.floor(st.rand() * 5000);
        sink({
          schemaVersion: 1,
          eventType: "market.quote",
          provider: this.key,
          instrumentId: inst.id,
          providerSymbol: inst.symbol,
          exchange: inst.exchange_id,
          eventTimestamp: nowIso,
          receivedTimestamp: nowIso,
          sequence: null,
          dataStatus: "simulated",
          bid: Math.round((st.last - spread / 2) * scale) / scale,
          ask: Math.round((st.last + spread / 2) * scale) / scale,
          last: st.last,
          open: st.open,
          high: st.high,
          low: st.low,
          prevClose: st.prevClose,
          volume: st.volume,
          openInterest: null,
          entitlement: "development-fixture",
        });
      }
    };
    emit();
    this.timer = setInterval(emit, 1500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}