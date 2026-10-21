import { getDb } from "@/lib/db";
import { ensureOptionInstrumentForQuote } from "@/lib/market/option-instrument";
import type { NormalizedDepth, NormalizedQuote, NormalizedTrade } from "@/lib/providers/types";

/**
 * In-process fan-out point for normalized market data.
 *
 * - Keeps the latest quote per (provider, instrument) in memory.
 * - Keeps the latest depth ladder per (provider, instrument) in memory — the
 *   ladder is transient state, not history; DOM views are produced live.
 * - Keeps a bounded ring buffer of the most recent trade prints per instrument
 *   (in-memory only; a persistent tape requires an event archive store).
 * - Persists a bounded quote snapshot to `quote_snapshots` (throttled 1/hr/key)
 *   so the DB never becomes a raw tick archive.
 * - Broadcasts to subscribers (the SSE gateway) without replaying raw ticks.
 * - Tracks upstream connection state per provider so status can be derived.
 *
 * In a multi-node deployment this becomes a Redis pub/sub or NATS hop; the
 * interface is intentionally transport-agnostic.
 */
type QuoteListener = (quote: NormalizedQuote) => void;
type DepthListener = (ladder: NormalizedDepth) => void;
type TradeListener = (trade: NormalizedTrade) => void;

const TRADE_RING_SIZE = 200;

interface ProviderFeedState {
  connected: boolean;
  lastEventAt: string | null;
  eventCount: number;
}

class QuoteHub {
  private quotes = new Map<string, NormalizedQuote>();
  private ladders = new Map<string, NormalizedDepth>();      // provider::instrumentId
  private trades = new Map<string, NormalizedTrade[]>();     // instrumentId → prints (newest last)
  private quoteListeners = new Set<QuoteListener>();
  private depthListeners = new Set<DepthListener>();
  private tradeListeners = new Set<TradeListener>();
  private feeds = new Map<string, ProviderFeedState>();
  private lastPersist = new Map<string, number>();
  private ensuredOptions = new Set<string>();

  private key(provider: string, instrumentId: string): string {
    return `${provider}::${instrumentId}`;
  }

  private touchFeed(provider: string, receivedTimestamp: string): ProviderFeedState {
    const feed = this.feeds.get(provider) ?? {
      connected: true,
      lastEventAt: null,
      eventCount: 0,
    };
    feed.connected = true;
    feed.lastEventAt = receivedTimestamp;
    feed.eventCount += 1;
    this.feeds.set(provider, feed);
    return feed;
  }

  ingest(quote: NormalizedQuote): void {
    // Bridge option quotes carry ids the instrument master may not know yet.
    // Register the option instrument (scoped to the bridge feed) before the
    // snapshot persist so the FK holds; retries until the underlying contract
    // row exists, never inventing one.
    const ensuredKey = `${quote.provider}::${quote.instrumentId}`;
    if (quote.instrumentId.startsWith("opt_") && !this.ensuredOptions.has(ensuredKey)) {
      if (ensureOptionInstrumentForQuote(quote)) {
        this.ensuredOptions.add(ensuredKey);
        // A failed first attempt (contract row missing) is retried on the next
        // quote rather than cached forever.
      } else if (getDb().prepare("SELECT 1 FROM instruments WHERE id = ?").get(quote.instrumentId)) {
        // Already registered (e.g. server restart) — stop retrying.
        this.ensuredOptions.add(ensuredKey);
      }
    }
    const k = this.key(quote.provider, quote.instrumentId);
    this.quotes.set(k, quote);
    this.touchFeed(quote.provider, quote.receivedTimestamp);
    this.persistThrottled(k, quote);
    for (const listener of this.quoteListeners) {
      try {
        listener(quote);
      } catch {
        // A bad listener must never break ingestion.
      }
    }
  }

  ingestDepth(ladder: NormalizedDepth): void {
    this.ladders.set(this.key(ladder.provider, ladder.instrumentId), ladder);
    this.touchFeed(ladder.provider, ladder.receivedTimestamp);
    for (const listener of this.depthListeners) {
      try {
        listener(ladder);
      } catch {
        // A bad listener must never break ingestion.
      }
    }
  }

  ingestTrade(trade: NormalizedTrade): void {
    this.touchFeed(trade.provider, trade.receivedTimestamp);
    const ring = this.trades.get(trade.instrumentId) ?? [];
    ring.push(trade);
    if (ring.length > TRADE_RING_SIZE) ring.splice(0, ring.length - TRADE_RING_SIZE);
    this.trades.set(trade.instrumentId, ring);
    for (const listener of this.tradeListeners) {
      try {
        listener(trade);
      } catch {
        // A bad listener must never break ingestion.
      }
    }
  }

  private persistThrottled(k: string, q: NormalizedQuote): void {
    const now = Date.now();
    const last = this.lastPersist.get(k) ?? 0;
    if (now - last < 1000) return;
    this.lastPersist.set(k, now);
    try {
      getDb()
        .prepare(
          `INSERT INTO quote_snapshots (
             instrument_id, provider, provider_symbol, exchange, bid, ask, last, open, high, low,
             prev_close, volume, open_interest, data_status, entitlement, event_timestamp,
             received_timestamp, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(instrument_id, provider) DO UPDATE SET
             provider_symbol=excluded.provider_symbol, exchange=excluded.exchange,
             bid=excluded.bid, ask=excluded.ask, last=excluded.last, open=excluded.open,
             high=excluded.high, low=excluded.low, prev_close=excluded.prev_close,
             volume=excluded.volume, open_interest=excluded.open_interest,
             data_status=excluded.data_status, entitlement=excluded.entitlement,
             event_timestamp=excluded.event_timestamp, received_timestamp=excluded.received_timestamp,
             updated_at=excluded.updated_at`,
        )
        .run(
          q.instrumentId,
          q.provider,
          q.providerSymbol,
          q.exchange,
          q.bid,
          q.ask,
          q.last,
          q.open,
          q.high,
          q.low,
          q.prevClose,
          q.volume,
          q.openInterest,
          q.dataStatus,
          q.entitlement,
          q.eventTimestamp,
          q.receivedTimestamp,
          new Date().toISOString(),
        );
    } catch {
      // Persistence failures must not interrupt streaming.
    }
  }

  subscribeQuote(listener: QuoteListener): () => void {
    this.quoteListeners.add(listener);
    return () => this.quoteListeners.delete(listener);
  }

  /** Compatibility alias used by the SSE route (quote events). */
  subscribe(listener: QuoteListener): () => void {
    return this.subscribeQuote(listener);
  }

  subscribeDepth(listener: DepthListener): () => void {
    this.depthListeners.add(listener);
    return () => this.depthListeners.delete(listener);
  }

  subscribeTrade(listener: TradeListener): () => void {
    this.tradeListeners.add(listener);
    return () => this.tradeListeners.delete(listener);
  }

  latestDepth(instrumentId: string): NormalizedDepth | undefined {
    let best: NormalizedDepth | undefined;
    for (const [k, d] of this.ladders) {
      if (!k.endsWith(`::${instrumentId}`)) continue;
      if (!best || new Date(d.receivedTimestamp) > new Date(best.receivedTimestamp)) best = d;
    }
    return best;
  }

  recentTrades(instrumentId: string, limit = 100): NormalizedTrade[] {
    const ring = this.trades.get(instrumentId) ?? [];
    return ring.slice(-limit).reverse(); // newest first
  }

  get(instrumentId: string, provider?: string): NormalizedQuote | undefined {
    if (provider) return this.quotes.get(this.key(provider, instrumentId));
    // Prefer the most recently received across providers.
    let best: NormalizedQuote | undefined;
    for (const [k, q] of this.quotes) {
      if (!k.endsWith(`::${instrumentId}`)) continue;
      if (!best || new Date(q.receivedTimestamp) > new Date(best.receivedTimestamp)) best = q;
    }
    return best;
  }

  all(): NormalizedQuote[] {
    return [...this.quotes.values()];
  }

  setFeedConnection(provider: string, connected: boolean): void {
    const feed = this.feeds.get(provider) ?? { connected, lastEventAt: null, eventCount: 0 };
    feed.connected = connected;
    this.feeds.set(provider, feed);
  }

  feedState(provider: string): ProviderFeedState {
    return this.feeds.get(provider) ?? { connected: false, lastEventAt: null, eventCount: 0 };
  }

  allFeeds(): Record<string, ProviderFeedState> {
    return Object.fromEntries(this.feeds.entries());
  }

  subscriberCount(): number {
    return this.quoteListeners.size + this.depthListeners.size + this.tradeListeners.size;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __fyipHub: QuoteHub | undefined;
}

export const quoteHub: QuoteHub = globalThis.__fyipHub ?? new QuoteHub();
globalThis.__fyipHub = quoteHub;