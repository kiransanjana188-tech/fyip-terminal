import { execute, isPostgres, queryAll, queryOne } from "@/lib/db";
import { quoteHub } from "@/lib/market/hub";
import { bridgeThresholds, type DataStatus } from "@/lib/market/status";
import type { DepthLevel, NormalizedDepth, NormalizedTrade } from "@/lib/providers/types";
import type { SideSource } from "@/lib/orderflow/classify";

const DEPTH_MIN_INTERVAL_MS = 1000;
const MAX_STORED_LEVELS = 15;
const PRUNE_EVERY_WRITES = 2000;
const MINUTE_KEY_LENGTH = 16;

const lastDepthPersist = new Map<string, number>();
let writesSincePrune = 0;
let lastArchiveError: string | null = null;

/** Last archive-write failure, exposed for deployment diagnostics. */
export function lastArchiveFailure(): string | null {
  return lastArchiveError;
}

function retentionHours(): number {
  const raw = Number(process.env.FYIP_ORDERFLOW_RETENTION_HOURS ?? 72);
  if (!Number.isFinite(raw)) return 72;
  return Math.min(720, Math.max(1, Math.round(raw)));
}

function maybePrune(): void {
  writesSincePrune += 1;
  if (writesSincePrune < PRUNE_EVERY_WRITES) return;
  writesSincePrune = 0;
  const cutoff = new Date(Date.now() - retentionHours() * 3_600_000).toISOString();
  try {
    execute("DELETE FROM trade_prints WHERE event_timestamp < ?", cutoff);
    execute("DELETE FROM depth_snapshots WHERE event_timestamp < ?", cutoff);
    execute("DELETE FROM futures_minute_volume WHERE minute < ?", cutoff.slice(0, MINUTE_KEY_LENGTH));
  } catch {
    // Retention is best-effort and must never block ingestion.
  }
}

export interface PendingTradePrint {
  trade: NormalizedTrade;
  sideSource: SideSource;
}

const TRADE_BATCH_ROWS = 80;

interface MinuteAggregate {
  instrumentId: string;
  minute: string;
  price: number;
  volume: number;
  buy: number;
  sell: number;
  prints: number;
  priceVolume: number;
}

/**
 * Persist a whole bridge payload with a handful of round trips instead of one
 * insert per print. Netlify Functions talk to Postgres over the network, so
 * batching is what keeps ingest within the request budget.
 */
export function recordTradePrints(batch: PendingTradePrint[]): void {
  if (batch.length === 0) return;
  try {
    for (let start = 0; start < batch.length; start += TRADE_BATCH_ROWS) {
      const chunk = batch.slice(start, start + TRADE_BATCH_ROWS);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params: (string | number | null)[] = [];
      for (const { trade, sideSource } of chunk) {
        params.push(
          trade.instrumentId,
          trade.provider,
          trade.providerSymbol,
          trade.price,
          trade.size,
          trade.side,
          sideSource,
          trade.eventTimestamp,
          trade.receivedTimestamp,
          trade.dataStatus,
          trade.sequence,
        );
      }
      execute(
        `INSERT INTO trade_prints (
           instrument_id, provider, provider_symbol, price, size, side, side_source,
           event_timestamp, received_timestamp, data_status, sequence)
         VALUES ${placeholders}`,
        ...params,
      );
    }

    const aggregates = new Map<string, MinuteAggregate>();
    for (const { trade } of batch) {
      const minute = trade.eventTimestamp.slice(0, MINUTE_KEY_LENGTH);
      const key = `${trade.instrumentId}|${minute}|${trade.price}`;
      const current = aggregates.get(key);
      const buy = trade.side === "buy" ? trade.size : 0;
      const sell = trade.side === "sell" ? trade.size : 0;
      if (current) {
        current.volume += trade.size;
        current.buy += buy;
        current.sell += sell;
        current.prints += 1;
        current.priceVolume += trade.price * trade.size;
      } else {
        aggregates.set(key, {
          instrumentId: trade.instrumentId,
          minute,
          price: trade.price,
          volume: trade.size,
          buy,
          sell,
          prints: 1,
          priceVolume: trade.price * trade.size,
        });
      }
    }

    const rows = [...aggregates.values()];
    for (let start = 0; start < rows.length; start += TRADE_BATCH_ROWS) {
      const chunk = rows.slice(start, start + TRADE_BATCH_ROWS);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params: (string | number)[] = [];
      for (const row of chunk) {
        params.push(
          row.instrumentId,
          row.minute,
          row.price,
          row.volume,
          row.buy,
          row.sell,
          row.prints,
          row.priceVolume,
        );
      }
      execute(
        `INSERT INTO futures_minute_volume (
           instrument_id, minute, price, volume, buy_volume, sell_volume, prints, price_volume)
         VALUES ${placeholders}
         ON CONFLICT(instrument_id, minute, price) DO UPDATE SET
           volume = futures_minute_volume.volume + excluded.volume,
           buy_volume = futures_minute_volume.buy_volume + excluded.buy_volume,
           sell_volume = futures_minute_volume.sell_volume + excluded.sell_volume,
           prints = futures_minute_volume.prints + excluded.prints,
           price_volume = futures_minute_volume.price_volume + excluded.price_volume`,
        ...params,
      );
    }
    maybePrune();
    lastArchiveError = null;
  } catch (err) {
    // Archive failures must not interrupt live streaming.
    lastArchiveError = err instanceof Error ? err.message : String(err);
  }
}

export function recordTradePrint(trade: NormalizedTrade, sideSource: SideSource): void {
  recordTradePrints([{ trade, sideSource }]);
}

export function recordDepthSnapshot(ladder: NormalizedDepth): void {
  const key = `${ladder.provider}::${ladder.instrumentId}`;
  const now = Date.now();
  const last = lastDepthPersist.get(key) ?? 0;
  if (now - last < DEPTH_MIN_INTERVAL_MS) return;
  lastDepthPersist.set(key, now);

  const bids = ladder.bids.slice(0, MAX_STORED_LEVELS);
  const asks = ladder.asks.slice(0, MAX_STORED_LEVELS);
  try {
    execute(
      `INSERT INTO depth_snapshots (
         instrument_id, provider, provider_symbol, event_timestamp, received_timestamp,
         bids, asks, data_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ladder.instrumentId,
      ladder.provider,
      ladder.providerSymbol,
      ladder.eventTimestamp,
      ladder.receivedTimestamp,
      JSON.stringify(bids),
      JSON.stringify(asks),
      ladder.dataStatus,
    );
    maybePrune();
  } catch {
    // Archive failures must not interrupt live streaming.
  }
}

export interface ArchivedTrade {
  id: number;
  instrumentId: string;
  provider: string;
  providerSymbol: string | null;
  price: number;
  size: number;
  side: "buy" | "sell" | "cross" | null;
  sideSource: SideSource;
  eventTimestamp: string;
  receivedTimestamp: string;
  dataStatus: DataStatus;
  sequence: number | null;
}

interface TradeRow {
  id: number;
  instrument_id: string;
  provider: string;
  provider_symbol: string | null;
  price: number;
  size: number;
  side: string | null;
  side_source: string;
  event_timestamp: string;
  received_timestamp: string;
  data_status: string;
  sequence: number | null;
}

export interface ArchivedDepth {
  id: number;
  instrumentId: string;
  provider: string;
  providerSymbol: string | null;
  eventTimestamp: string;
  receivedTimestamp: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  dataStatus: DataStatus;
}

interface DepthRow {
  id: number;
  instrument_id: string;
  provider: string;
  provider_symbol: string | null;
  event_timestamp: string;
  received_timestamp: string;
  bids: string;
  asks: string;
  data_status: string;
}

export interface ArchiveQuery {
  limit?: number;
  from?: string | null;
  to?: string | null;
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (!limit || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.round(limit)));
}

function parseLevels(raw: string): DepthLevel[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (level): level is DepthLevel =>
          typeof level === "object" &&
          level !== null &&
          Number.isFinite((level as DepthLevel).price) &&
          Number.isFinite((level as DepthLevel).volume),
      )
      .map((level) => ({ price: level.price, volume: level.volume }));
  } catch {
    return [];
  }
}

export function archivedTrades(instrumentId: string, query: ArchiveQuery = {}): ArchivedTrade[] {
  const limit = clampLimit(query.limit, 2000, 10_000);
  const where = ["instrument_id = ?"];
  const params: (string | number)[] = [instrumentId];
  if (query.from) {
    where.push("event_timestamp >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("event_timestamp <= ?");
    params.push(query.to);
  }
  params.push(limit);

  const rows = queryAll<TradeRow>(
    `SELECT * FROM trade_prints
      WHERE ${where.join(" AND ")}
      ORDER BY event_timestamp DESC, id DESC
      LIMIT ?`,
    ...params,
  );

  return rows.reverse().map((row) => ({
    id: row.id,
    instrumentId: row.instrument_id,
    provider: row.provider,
    providerSymbol: row.provider_symbol,
    price: row.price,
    size: row.size,
    side:
      row.side === "buy" || row.side === "sell" || row.side === "cross"
        ? row.side
        : null,
    sideSource:
      row.side_source === "provider" || row.side_source === "inferred"
        ? row.side_source
        : "unknown",
    eventTimestamp: row.event_timestamp,
    receivedTimestamp: row.received_timestamp,
    dataStatus: row.data_status as DataStatus,
    sequence: row.sequence,
  }));
}

export function archivedDepth(instrumentId: string, query: ArchiveQuery = {}): ArchivedDepth[] {
  const limit = clampLimit(query.limit, 2000, 5000);
  const where = ["instrument_id = ?"];
  const params: (string | number)[] = [instrumentId];
  if (query.from) {
    where.push("event_timestamp >= ?");
    params.push(query.from);
  }
  if (query.to) {
    where.push("event_timestamp <= ?");
    params.push(query.to);
  }
  params.push(limit);

  const rows = queryAll<DepthRow>(
    `SELECT * FROM depth_snapshots
      WHERE ${where.join(" AND ")}
      ORDER BY event_timestamp DESC, id DESC
      LIMIT ?`,
    ...params,
  );

  return rows.reverse().map((row) => ({
    id: row.id,
    instrumentId: row.instrument_id,
    provider: row.provider,
    providerSymbol: row.provider_symbol,
    eventTimestamp: row.event_timestamp,
    receivedTimestamp: row.received_timestamp,
    bids: parseLevels(row.bids),
    asks: parseLevels(row.asks),
    dataStatus: row.data_status as DataStatus,
  }));
}

export interface ArchivedBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

interface BarRow {
  bucket: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export function archivedBars(instrumentId: string, stepSeconds: number, maxBars: number): ArchivedBar[] {
  const step = Math.max(1, Math.round(stepSeconds));
  const limit = Math.min(2000, Math.max(1, Math.round(maxBars)));
  const bucket =
    isPostgres()
      ? "(EXTRACT(EPOCH FROM event_timestamp::timestamptz)::bigint / ?) * ?"
      : "(CAST(strftime('%s', event_timestamp) AS INTEGER) / ?) * ?";
  const rows = queryAll<BarRow>(
    `WITH src AS (
       SELECT id, price, size, event_timestamp,
              ${bucket} AS bucket
       FROM trade_prints
       WHERE instrument_id = ?
     ),
     ranked AS (
       SELECT bucket, price, size, event_timestamp,
              ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY event_timestamp ASC, id ASC) AS first_rank,
              ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY event_timestamp DESC, id DESC) AS last_rank
       FROM src
     ),
     grouped AS (
       SELECT bucket,
              MAX(CASE WHEN first_rank = 1 THEN price END) AS open,
              MAX(CASE WHEN last_rank = 1 THEN price END) AS close,
              MAX(price) AS high,
              MIN(price) AS low,
              SUM(size) AS volume,
              COUNT(*) AS trades
       FROM ranked
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT ?
     )
     SELECT * FROM grouped ORDER BY bucket ASC`,
    step,
    step,
    instrumentId,
    limit,
  );
  return rows.map((row) => ({
    time: row.bucket,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    trades: row.trades,
  }));
}

export interface ArchiveWindow {
  tradeCount: number;
  depthCount: number;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  firstDepthAt: string | null;
  lastDepthAt: string | null;
}

export function archiveWindow(instrumentId: string): ArchiveWindow {
  const trades = queryOne<{ count: number; first: string | null; last: string | null }>(
    "SELECT COUNT(*) AS count, MIN(event_timestamp) AS first, MAX(event_timestamp) AS last FROM trade_prints WHERE instrument_id = ?",
    instrumentId,
  );
  const depth = queryOne<{ count: number; first: string | null; last: string | null }>(
    "SELECT COUNT(*) AS count, MIN(event_timestamp) AS first, MAX(event_timestamp) AS last FROM depth_snapshots WHERE instrument_id = ?",
    instrumentId,
  );
  return {
    tradeCount: trades?.count ?? 0,
    depthCount: depth?.count ?? 0,
    firstTradeAt: trades?.first ?? null,
    lastTradeAt: trades?.last ?? null,
    firstDepthAt: depth?.first ?? null,
    lastDepthAt: depth?.last ?? null,
  };
}

export function archiveDataStatus(latestIso: string | null): DataStatus {
  if (!latestIso) return "unavailable";
  const ageMs = Date.now() - new Date(latestIso).getTime();
  if (!Number.isFinite(ageMs)) return "unavailable";
  const feed = quoteHub.feedState("ninjatrader");
  const { staleSeconds, disconnectSeconds } = bridgeThresholds();
  const ageSeconds = ageMs / 1000;
  if (!feed.connected) {
    if (!isPostgres()) return "historical";
    // Serverless instances do not see the bridge request directly; fall back to
    // the age of the stored print.
    if (ageSeconds > disconnectSeconds) return "historical";
  }
  if (ageSeconds > disconnectSeconds) return "disconnected";
  if (ageSeconds > staleSeconds) return "stale";
  return "live";
}
