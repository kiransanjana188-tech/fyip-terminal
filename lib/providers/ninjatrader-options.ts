import { queryAll, queryOne } from "@/lib/db";
import { black76ImpliedVol, black76Gamma } from "@/lib/finance/black76";
import { getInstrument } from "@/lib/market/instruments";
import { parseOptionInstrumentId } from "@/lib/market/option-instrument";
import { quoteHub } from "@/lib/market/hub";
import type { DataStatus } from "@/lib/market/status";
import type {
  OptionContractQuote,
  OptionsDataProvider,
  ProviderCapabilities,
} from "./types";

/**
 * Options chain adapter over the NinjaTrader bridge's CME futures-option
 * quotes. The desktop Add-On subscribes the CME option strike grid around the
 * front quarterly contract (`optionsMap` in fyip_bridge_options.json) and
 * publishes standard `market.quote` events with `openInterest` populated from
 * Rithmic's daily Open Interest updates. This adapter turns those stored
 * snapshots into a GEX-ready chain:
 *
 *  - premium = (bid + ask) / 2, else last trade (never a synthesized number)
 *  - forward F = latest quote of the underlying quarterly contract
 *  - IV solved with Black-76 (r = 0), T = calendar days to expiration / 365
 *  - gamma computed from the solved IV — labelled fyip_calculated
 *
 * No contract is invented: strikes/expirations come from the bridge feed and
 * the seeded instrument master. If the entitlement does not stream Open
 * Interest, rows arrive with null OI and the chain reports it honestly.
 */
export class NinjaTraderOptionsProvider implements OptionsDataProvider {
  readonly key = "ninjatrader_options";
  readonly kind = "options" as const;
  readonly label = "NinjaTrader Bridge (CME futures options)";

  capabilities(): Pick<ProviderCapabilities, "live" | "historical" | "options" | "entitlement"> {
    return {
      live: true,
      historical: false,
      options: true,
      entitlement: "Rithmic/CME options entitlement via the NinjaTrader bridge",
    };
  }

  isConfigured(): boolean {
    return typeof process.env.FYIP_BRIDGE_TOKEN === "string" && process.env.FYIP_BRIDGE_TOKEN.length > 0;
  }

  /** Index roots the bridge's CME option-grid expansion supports today. */
  supportedSymbols(): readonly string[] {
    return ["ES", "NQ"];
  }

  async fetchChain(underlyingId: string): Promise<OptionContractQuote[]> {
    const root = getInstrument(underlyingId);
    if (!root) return [];

    // Quarterly contracts of this root that are seeded in the instrument
    // master with a known expiration (ESZ6, ESH7, …), oldest-excluded rows
    // simply produce an empty quote scan.
    const seedRows = queryAll<{ id: string; symbol: string; expiration: string | null }>(
      `SELECT id, symbol, expiration FROM instruments
        WHERE asset_class = 'future' AND is_continuous = 0 AND expiration IS NOT NULL
          AND symbol LIKE ?`,
      `${root.symbol}%`,
    );
    const contracts = seedRows.filter(
      (r) =>
        r.symbol.length === root.symbol.length + 2 &&
        /^[FGHJKMNQUVXZ]\d$/.test(r.symbol.slice(-2)),
    );

    const out: OptionContractQuote[] = [];
    for (const c of contracts) {
      const forward = this.forwardFor(c.id);
      if (forward === null) continue;

      const quotes = queryAll<{
        instrument_id: string;
        bid: number | null;
        ask: number | null;
        last: number | null;
        volume: number | null;
        open_interest: number | null;
        data_status: string;
        received_timestamp: string;
      }>(
        `SELECT instrument_id, bid, ask, last, volume, open_interest,
                data_status, received_timestamp
           FROM quote_snapshots
          WHERE provider = 'ninjatrader'
            AND instrument_id LIKE ?`,
        `opt_${c.symbol.toLowerCase()}_%`,
      );

      for (const row of quotes) {
        const parsed = parseOptionInstrumentId(row.instrument_id);
        if (!parsed) continue;

        const premium = midPrice(row.bid, row.ask) ?? row.last;
        if (premium === null || !(premium > 0)) continue;

        const T = yearsToExpiry(c.expiration as string, row.received_timestamp);
        const iv = black76ImpliedVol(premium, {
          forward,
          strike: parsed.strike,
          timeToExpiry: T,
          type: parsed.optionType,
        });
        const gamma =
          iv !== null
            ? black76Gamma({ forward, strike: parsed.strike, timeToExpiry: T, vol: iv })
            : null;

        out.push({
          expiration: (c.expiration as string).slice(0, 10),
          strike: parsed.strike,
          optionType: parsed.optionType,
          bid: row.bid,
          ask: row.ask,
          last: row.last,
          volume: row.volume,
          openInterest: row.open_interest,
          impliedVol: iv,
          greeksSource: iv === null ? "unavailable" : "fyip_calculated",
          gamma: gamma ?? null,
          underlyingPrice: forward,
          dataStatus: row.data_status as DataStatus,
          asOf: row.received_timestamp,
        });
      }
    }

    out.sort(
      (a, b) =>
        a.expiration.localeCompare(b.expiration) ||
        a.strike - b.strike ||
        a.optionType.localeCompare(b.optionType),
    );
    return out;
  }

  /** Latest forward for a contract: in-memory hub quote, else stored snapshot. */
  private forwardFor(contractId: string): number | null {
    const live = quoteHub.get(contractId, "ninjatrader");
    const livePrice = live?.last ?? live?.bid ?? live?.ask;
    if (typeof livePrice === "number" && livePrice > 0) return livePrice;

    const snap = queryOne<{ bid: number | null; ask: number | null; last: number | null }>(
      `SELECT bid, ask, last FROM quote_snapshots
        WHERE instrument_id = ? AND provider = 'ninjatrader'`,
      contractId,
    );
    if (!snap) return null;
    return midPrice(snap.bid, snap.ask) ?? snap.last;
  }
}

/** Descriptive mid from bid/ask when both sides quotation is usable. */
function midPrice(bid: number | null, ask: number | null): number | null {
  if (bid !== null && ask !== null && bid > 0 && ask >= bid) return (bid + ask) / 2;
  return null;
}

/** Calendar days to the options expiration over 365, per FYIP conventions. */
function yearsToExpiry(expiration: string, asOf: string): number {
  const exp = Date.parse(`${expiration.slice(0, 10)}T20:00:00Z`);
  if (!Number.isFinite(exp)) return 0;
  const asOfMs = Date.parse(asOf);
  const from = Number.isFinite(asOfMs) ? asOfMs : Date.now();
  return Math.max(0, exp - Math.min(from, exp)) / 86_400_000 / 365;
}
