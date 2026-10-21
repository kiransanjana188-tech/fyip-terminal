import type { AggressorSide, SideSource } from "./classify";
import { computeValueArea } from "./studies";

export interface FootprintTrade {
  price: number;
  size: number;
  side: AggressorSide;
  sideSource?: SideSource;
  eventTimestamp: string;
}

export interface FootprintLevel {
  price: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  totalVolume: number;
  delta: number;
  buyImbalance: boolean;
  sellImbalance: boolean;
  isPoc: boolean;
}

export interface FootprintBar {
  startTime: number;
  endTime: number;
  levels: FootprintLevel[];
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  totalVolume: number;
  delta: number;
  cumulativeDelta: number;
  pocPrice: number | null;
  tradeCount: number;
  low: number;
  high: number;
}

export interface FootprintSideCoverage {
  providerPct: number;
  inferredPct: number;
  unknownPct: number;
}

export interface FootprintSession {
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  delta: number;
  pocPrice: number | null;
  valueAreaHigh: number | null;
  valueAreaLow: number | null;
  priceLow: number | null;
  priceHigh: number | null;
  prints: number;
  bars: number;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  sideCoverage: FootprintSideCoverage;
  classifiedPct: number;
}

export interface FootprintResult {
  bars: FootprintBar[];
  session: FootprintSession;
  rowStep: number;
}

export interface FootprintOptions {
  bucketMs: number;
  tickSize?: number;
  rowTicks?: number;
  imbalanceRatio?: number;
  minImbalanceVolume?: number;
}

interface MutableLevel {
  key: number;
  price: number;
  buy: number;
  sell: number;
  unknown: number;
}

function roundPrice(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function emptySession(): FootprintSession {
  return {
    totalVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    unknownVolume: 0,
    delta: 0,
    pocPrice: null,
    valueAreaHigh: null,
    valueAreaLow: null,
    priceLow: null,
    priceHigh: null,
    prints: 0,
    bars: 0,
    firstTradeAt: null,
    lastTradeAt: null,
    sideCoverage: { providerPct: 0, inferredPct: 0, unknownPct: 0 },
    classifiedPct: 0,
  };
}

export function buildFootprint(trades: FootprintTrade[], options: FootprintOptions): FootprintResult {
  const bucketMs = Math.max(250, options.bucketMs);
  const step = Math.max(options.tickSize ?? 0.01, 1e-8) * Math.max(1, Math.round(options.rowTicks ?? 1));
  const ratio = Math.max(1, options.imbalanceRatio ?? 3);
  const minImbalanceVolume = Math.max(0, options.minImbalanceVolume ?? 0);

  const ordered = [...trades].sort(
    (a, b) => new Date(a.eventTimestamp).getTime() - new Date(b.eventTimestamp).getTime(),
  );

  const buckets = new Map<number, { levels: Map<number, MutableLevel>; count: number; low: number; high: number }>();
  const sessionLevels = new Map<number, MutableLevel>();
  const sourceVolume = { provider: 0, inferred: 0, unknown: 0 };
  let sessionBuy = 0;
  let sessionSell = 0;
  let sessionUnknown = 0;
  let firstTradeAt: string | null = null;
  let lastTradeAt: string | null = null;

  for (const trade of ordered) {
    const ts = new Date(trade.eventTimestamp).getTime();
    if (!Number.isFinite(ts) || !Number.isFinite(trade.price) || !Number.isFinite(trade.size)) continue;
    const bucketStart = Math.floor(ts / bucketMs) * bucketMs;
    const key = Math.round(trade.price / step);
    const price = roundPrice(key * step);
    const size = Math.max(0, trade.size);

    let bucket = buckets.get(bucketStart);
    if (!bucket) {
      bucket = { levels: new Map(), count: 0, low: trade.price, high: trade.price };
      buckets.set(bucketStart, bucket);
    }
    bucket.count += 1;
    bucket.low = Math.min(bucket.low, trade.price);
    bucket.high = Math.max(bucket.high, trade.price);

    let level = bucket.levels.get(key);
    if (!level) {
      level = { key, price, buy: 0, sell: 0, unknown: 0 };
      bucket.levels.set(key, level);
    }

    let sessionLevel = sessionLevels.get(key);
    if (!sessionLevel) {
      sessionLevel = { key, price, buy: 0, sell: 0, unknown: 0 };
      sessionLevels.set(key, sessionLevel);
    }

    if (trade.side === "buy") {
      level.buy += size;
      sessionLevel.buy += size;
      sessionBuy += size;
    } else if (trade.side === "sell") {
      level.sell += size;
      sessionLevel.sell += size;
      sessionSell += size;
    } else {
      level.unknown += size;
      sessionLevel.unknown += size;
      sessionUnknown += size;
    }

    const source: SideSource =
      trade.sideSource ?? (trade.side === "buy" || trade.side === "sell" ? "provider" : "unknown");
    sourceVolume[source] += size;

    if (!firstTradeAt || ts < new Date(firstTradeAt).getTime()) firstTradeAt = trade.eventTimestamp;
    if (!lastTradeAt || ts > new Date(lastTradeAt).getTime()) lastTradeAt = trade.eventTimestamp;
  }

  const bars: FootprintBar[] = [];
  let cumulativeDelta = 0;

  for (const start of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(start)!;
    const mutable = [...bucket.levels.values()].sort((a, b) => b.price - a.price);
    const levels: FootprintLevel[] = mutable.map((level, index) => {
      const total = level.buy + level.sell + level.unknown;
      const buyImbalance =
        level.buy >= minImbalanceVolume &&
        level.buy > 0 &&
        index + 1 < mutable.length &&
        level.buy >= ratio * mutable[index + 1].sell;
      const sellImbalance =
        level.sell >= minImbalanceVolume &&
        level.sell > 0 &&
        index - 1 >= 0 &&
        level.sell >= ratio * mutable[index - 1].buy;
      return {
        price: level.price,
        buyVolume: level.buy,
        sellVolume: level.sell,
        unknownVolume: level.unknown,
        totalVolume: total,
        delta: level.buy - level.sell,
        buyImbalance,
        sellImbalance,
        isPoc: false,
      };
    });

    let pocPrice: number | null = null;
    let pocVolume = -1;
    let buyVolume = 0;
    let sellVolume = 0;
    let unknownVolume = 0;
    for (const level of levels) {
      buyVolume += level.buyVolume;
      sellVolume += level.sellVolume;
      unknownVolume += level.unknownVolume;
      if (level.totalVolume > pocVolume) {
        pocVolume = level.totalVolume;
        pocPrice = level.price;
      }
    }
    for (const level of levels) if (level.price === pocPrice) level.isPoc = true;

    const delta = buyVolume - sellVolume;
    cumulativeDelta += delta;
    const totalVolume = buyVolume + sellVolume + unknownVolume;

    bars.push({
      startTime: start,
      endTime: start + bucketMs,
      levels,
      buyVolume,
      sellVolume,
      unknownVolume,
      totalVolume,
      delta,
      cumulativeDelta,
      pocPrice,
      tradeCount: bucket.count,
      low: bucket.low,
      high: bucket.high,
    });
  }

  const sessionMutable = [...sessionLevels.values()].sort((a, b) => b.price - a.price);
  sessionBuy = 0;
  sessionSell = 0;
  sessionUnknown = 0;
  const sessionPoints = sessionMutable.map((level) => {
    sessionBuy += level.buy;
    sessionSell += level.sell;
    sessionUnknown += level.unknown;
    return {
      price: level.price,
      total: level.buy + level.sell + level.unknown,
      buy: level.buy,
      sell: level.sell,
      unknown: level.unknown,
    };
  });
  const totalVolume = sessionBuy + sessionSell + sessionUnknown;
  const valueArea = computeValueArea(sessionPoints, 0.7);

  const session: FootprintSession = {
    totalVolume,
    buyVolume: sessionBuy,
    sellVolume: sessionSell,
    unknownVolume: sessionUnknown,
    delta: sessionBuy - sessionSell,
    pocPrice: valueArea.pocPrice,
    valueAreaHigh: valueArea.valueAreaHigh,
    valueAreaLow: valueArea.valueAreaLow,
    priceLow: sessionMutable.length > 0 ? sessionMutable[sessionMutable.length - 1].price : null,
    priceHigh: sessionMutable.length > 0 ? sessionMutable[0].price : null,
    prints: ordered.length,
    bars: bars.length,
    firstTradeAt,
    lastTradeAt,
    sideCoverage: {
      providerPct: totalVolume > 0 ? (sourceVolume.provider / totalVolume) * 100 : 0,
      inferredPct: totalVolume > 0 ? (sourceVolume.inferred / totalVolume) * 100 : 0,
      unknownPct: totalVolume > 0 ? (sourceVolume.unknown / totalVolume) * 100 : 0,
    },
    classifiedPct: totalVolume > 0 ? ((sessionBuy + sessionSell) / totalVolume) * 100 : 0,
  };

  return { bars, session, rowStep: step };
}

export function emptyFootprint(): FootprintResult {
  return {
    bars: [],
    session: emptySession(),
    rowStep: 0.01,
  };
}
