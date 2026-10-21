import { queryAll } from "@/lib/db";
import { computeValueArea } from "@/lib/orderflow/studies";

/**
 * Futures-only analytics computed from real trade prints (NinjaTrader bridge
 * order-flow archive). No options data is involved: session levels, VWAP and
 * volume-at-price are derived strictly from executed prints.
 *
 * Every function is intentionally split between SQL aggregation (`load…`) and
 * pure assembly (`assemble…`) so the math is unit-testable without a database.
 */

export interface FuturesProfileBin {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  delta: number;
}

export interface FuturesProfile {
  rowStep: number;
  bins: FuturesProfileBin[];
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  delta: number;
  pocPrice: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
}

export interface FuturesSurfaceBucket {
  key: string;
  label: string;
}

export interface FuturesSurfaceCell {
  bucket: string;
  price: number;
  volume: number;
  delta: number;
}

export interface FuturesSurface {
  bucketMinutes: number;
  rowStep: number;
  buckets: FuturesSurfaceBucket[];
  prices: number[];
  cells: FuturesSurfaceCell[];
  maxVolume: number;
  maxAbsDelta: number;
}

export interface PriceAggregateRow {
  key: number;
  volume: number;
  buy: number;
  sell: number;
  unknown: number;
}

export interface CellAggregateRow {
  bucket: string;
  key: number;
  volume: number;
  buy: number;
  sell: number;
}

export interface MinuteCellRow {
  minute: string;
  key: number;
  volume: number;
  buy: number;
  sell: number;
  prints: number;
  priceVolume: number;
}

interface MinutePriceRow {
  minute: string;
  price: number;
  volume: number;
  buy: number;
  sell: number;
  prints: number;
  priceVolume: number;
}

export interface WindowStats {
  count: number;
  minPrice: number | null;
  maxPrice: number | null;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  priceVolume: number | null;
  volume: number | null;
}

export interface FuturesAnalyticsQuery {
  instrumentId: string;
  hours: number;
  tickSize: number;
  rowTicks: number;
  bucketMinutes: number;
}

export interface FuturesAnalyticsData {
  tradeCount: number;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  vwap: number | null;
  profile: FuturesProfile | null;
  surface: FuturesSurface | null;
  warnings: string[];
}

export function roundPrice(value: number, step: number): number {
  return Math.round(value * 1e8) / 1e8;
  // step is baked into the key by the SQL aggregation; this guard only removes
  // binary floating-point noise from key * step products.
}

export function assembleProfile(rows: PriceAggregateRow[], rowStep: number): FuturesProfile {
  const step = Math.max(rowStep, 1e-8);
  const bins: FuturesProfileBin[] = rows
    .filter((row) => Number.isFinite(row.key) && Number.isFinite(row.volume))
    .map((row) => ({
      price: roundPrice(row.key * step, step),
      volume: row.volume,
      buyVolume: row.buy,
      sellVolume: row.sell,
      unknownVolume: row.unknown,
      delta: row.buy - row.sell,
    }))
    .sort((a, b) => a.price - b.price);

  let totalVolume = 0;
  let buyVolume = 0;
  let sellVolume = 0;
  let unknownVolume = 0;
  for (const bin of bins) {
    totalVolume += bin.volume;
    buyVolume += bin.buyVolume;
    sellVolume += bin.sellVolume;
    unknownVolume += bin.unknownVolume;
  }
  const valueArea = computeValueArea(
    [...bins].map((bin) => ({ price: bin.price, total: bin.volume })),
    0.7,
  );

  return {
    rowStep: step,
    bins,
    totalVolume,
    buyVolume,
    sellVolume,
    unknownVolume,
    delta: buyVolume - sellVolume,
    pocPrice: valueArea.pocPrice,
    valueAreaHigh: valueArea.valueAreaHigh,
    valueAreaLow: valueArea.valueAreaLow,
  };
}

export function assembleSurface(
  rows: CellAggregateRow[],
  buckets: FuturesSurfaceBucket[],
  minKey: number,
  maxKey: number,
  rowStep: number,
  bucketMinutes: number,
): FuturesSurface {
  const step = Math.max(rowStep, 1e-8);
  const prices: number[] = [];
  for (let key = minKey; key <= maxKey; key += 1) prices.push(roundPrice(key * step, step));

  let maxVolume = 0;
  let maxAbsDelta = 0;
  const cells: FuturesSurfaceCell[] = rows.map((row) => {
    const delta = row.buy - row.sell;
    if (row.volume > maxVolume) maxVolume = row.volume;
    if (Math.abs(delta) > maxAbsDelta) maxAbsDelta = Math.abs(delta);
    return { bucket: row.bucket, price: roundPrice(row.key * step, step), volume: row.volume, delta };
  });

  return { bucketMinutes, rowStep: step, buckets, prices, cells, maxVolume, maxAbsDelta };
}

export function computeVwap(priceVolume: number | null, volume: number | null): number | null {
  if (priceVolume === null || volume === null || !Number.isFinite(priceVolume) || !Number.isFinite(volume)) return null;
  if (volume <= 0) return null;
  return priceVolume / volume;
}

export function bucketLabel(key: string): string {
  // key looks like "2026-10-20T17:05"; show the HH:MM part.
  const colon = key.indexOf("T");
  return colon >= 0 ? key.slice(colon + 1) : key;
}

/** Collapse per-minute price rows into the full-window price profile. */
export function aggregateProfileRows(rows: MinuteCellRow[]): PriceAggregateRow[] {
  const map = new Map<number, PriceAggregateRow>();
  for (const row of rows) {
    let agg = map.get(row.key);
    if (!agg) {
      agg = { key: row.key, volume: 0, buy: 0, sell: 0, unknown: 0 };
      map.set(row.key, agg);
    }
    agg.volume += row.volume;
    agg.buy += row.buy;
    agg.sell += row.sell;
  }
  for (const agg of map.values()) agg.unknown = Math.max(0, agg.volume - agg.buy - agg.sell);
  return [...map.values()].sort((a, b) => a.key - b.key);
}

/** Floor a "YYYY-MM-DDTHH:MM" minute key into a fixed-width time bucket. */
export function bucketMinute(minute: string, bucketMinutes: number): { key: string; label: string } {
  const width = Math.max(1, Math.round(bucketMinutes));
  const hour = minute.slice(11, 13);
  const mins = Number(minute.slice(14, 16));
  const start = Number.isFinite(mins) ? Math.floor(mins / width) * width : 0;
  const mm = String(start).padStart(2, "0");
  return { key: `${minute.slice(0, 13)}:${mm}`, label: `${hour}:${mm}` };
}

/** Collapse per-minute price rows into time × price cells for the surface. */
export function aggregateSurfaceRows(
  rows: MinuteCellRow[],
  bucketMinutes: number,
  keyDivisor = 1,
): { cells: CellAggregateRow[]; buckets: FuturesSurfaceBucket[]; minKey: number; maxKey: number } {
  const divisor = Math.max(1, Math.round(keyDivisor));
  const cellMap = new Map<string, CellAggregateRow>();
  const bucketMap = new Map<string, string>();
  let minKey = Number.POSITIVE_INFINITY;
  let maxKey = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const bucket = bucketMinute(row.minute, bucketMinutes);
    bucketMap.set(bucket.key, bucket.label);
    const key = Math.round(row.key / divisor);
    if (key < minKey) minKey = key;
    if (key > maxKey) maxKey = key;
    const id = `${bucket.key}|${key}`;
    let agg = cellMap.get(id);
    if (!agg) {
      agg = { bucket: bucket.key, key, volume: 0, buy: 0, sell: 0 };
      cellMap.set(id, agg);
    }
    agg.volume += row.volume;
    agg.buy += row.buy;
    agg.sell += row.sell;
  }

  const buckets = [...bucketMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, label]) => ({ key, label }));
  const cells = [...cellMap.values()].sort((a, b) =>
    a.bucket === b.bucket ? a.key - b.key : a.bucket.localeCompare(b.bucket),
  );
  return {
    cells,
    buckets,
    minKey: Number.isFinite(minKey) ? minKey : 0,
    maxKey: Number.isFinite(maxKey) ? maxKey : 0,
  };
}

const MAX_SURFACE_ROWS = 140;
const MAX_SURFACE_BUCKETS = 160;

export function loadFuturesAnalytics(query: FuturesAnalyticsQuery): FuturesAnalyticsData {
  const hours = Math.min(72, Math.max(1, Math.round(query.hours)));
  const from = new Date(Date.now() - hours * 3600_000).toISOString();

  const empty: FuturesAnalyticsData = {
    tradeCount: 0,
    firstTradeAt: null,
    lastTradeAt: null,
    vwap: null,
    profile: null,
    surface: null,
    warnings: [],
  };

  const tick = Math.max(1e-8, query.tickSize || 0.25);
  const profileStep = roundPrice(tick * Math.max(1, Math.round(query.rowTicks)), tick);

  // Read the materialized minute aggregates (maintained on ingest and
  // backfilled once by migration 9) so this stays a small indexed range scan,
  // then bin prices to the requested row size in memory.
  const cells = queryAll<MinutePriceRow>(
    `SELECT minute, price, volume, buy_volume AS buy, sell_volume AS sell,
            prints, price_volume AS priceVolume
       FROM futures_minute_volume
      WHERE instrument_id = ? AND minute >= ?
      ORDER BY minute ASC`,
    query.instrumentId,
    from.slice(0, 16),
  );
  const rows: MinuteCellRow[] = cells.map((cell) => ({
    minute: cell.minute,
    key: Math.round(cell.price / profileStep),
    volume: cell.volume,
    buy: cell.buy,
    sell: cell.sell,
    prints: cell.prints,
    priceVolume: cell.priceVolume,
  }));
  if (rows.length === 0) return empty;

  let prints = 0;
  let volume = 0;
  let priceVolume = 0;
  let minKey = Number.POSITIVE_INFINITY;
  let maxKey = Number.NEGATIVE_INFINITY;
  let firstMinute: string | null = null;
  let lastMinute: string | null = null;
  for (const row of rows) {
    prints += row.prints;
    volume += row.volume;
    priceVolume += row.priceVolume;
    if (row.key < minKey) minKey = row.key;
    if (row.key > maxKey) maxKey = row.key;
    if (!firstMinute || row.minute < firstMinute) firstMinute = row.minute;
    if (!lastMinute || row.minute > lastMinute) lastMinute = row.minute;
  }

  const profile = assembleProfile(aggregateProfileRows(rows), profileStep);

  // Coarsen the surface grid so the 3D chart stays readable and payload small.
  const rowSpan = maxKey - minKey + 1;
  const keyDivisor = Math.max(1, Math.ceil(rowSpan / MAX_SURFACE_ROWS));
  const surfaceStep = roundPrice(profileStep * keyDivisor, tick);

  let bucketMinutes = Math.max(1, Math.round(query.bucketMinutes));
  const firstMs = firstMinute ? Date.parse(`${firstMinute}:00Z`) : Number.NaN;
  const lastMs = lastMinute ? Date.parse(`${lastMinute}:00Z`) : Number.NaN;
  const spanMinutes = Number.isFinite(firstMs) && Number.isFinite(lastMs) ? Math.max(0, (lastMs - firstMs) / 60_000) : 0;
  while (spanMinutes / bucketMinutes + 1 > MAX_SURFACE_BUCKETS) bucketMinutes *= 2;

  const surfaceRows = aggregateSurfaceRows(rows, bucketMinutes, keyDivisor);
  const surface = assembleSurface(
    surfaceRows.cells,
    surfaceRows.buckets,
    surfaceRows.minKey,
    surfaceRows.maxKey,
    surfaceStep,
    bucketMinutes,
  );

  const warnings: string[] = [];
  if (keyDivisor > 1) {
    warnings.push(
      `Surface rows coarsened to ${surfaceStep} points so the grid stays readable; the profile keeps ${profileStep}-point rows.`,
    );
  }
  if (bucketMinutes > Math.max(1, Math.round(query.bucketMinutes))) {
    warnings.push(`Time buckets widened to ${bucketMinutes} minutes to stay under ${MAX_SURFACE_BUCKETS} columns.`);
  }

  return {
    tradeCount: prints,
    firstTradeAt: firstMinute ? `${firstMinute}:00Z` : null,
    lastTradeAt: lastMinute ? `${lastMinute}:59.999Z` : null,
    vwap: computeVwap(priceVolume, volume),
    profile,
    surface,
    warnings,
  };
}
