import { describe, it, expect } from "vitest";
import { normalizeBridgeEvent, normalizeDepthEvent, normalizeTradeEvent } from "../lib/providers/ninjatrader-bridge";
import { derivePriority } from "../lib/news/engine";

describe("NinjaTrader bridge normalization", () => {
  const valid = {
    schemaVersion: 1,
    eventType: "market.quote",
    provider: "ninjatrader",
    instrumentId: "inst_es1!",
    providerSymbol: "ES 03-26",
    exchange: "CME",
    eventTimestamp: "2026-01-01T12:00:00.000Z",
    receivedTimestamp: "2026-01-01T12:00:00.100Z",
    sequence: 42,
    dataStatus: "live",
    bid: 5000.25,
    ask: 5000.5,
    last: 5000.25,
    volume: 1200,
    entitlement: "exchange-entitlement-required",
  };

  it("accepts and normalizes a valid event", () => {
    const { quote, errors } = normalizeBridgeEvent(valid);
    expect(errors).toHaveLength(0);
    expect(quote?.instrumentId).toBe("inst_es1!");
    expect(quote?.bid).toBe(5000.25);
    expect(quote?.sequence).toBe(42);
  });

  it("rejects an unsupported schema version", () => {
    const { quote, errors } = normalizeBridgeEvent({ ...valid, schemaVersion: 99 });
    expect(quote).toBeUndefined();
    expect(errors.join(" ")).toMatch(/schemaVersion/);
  });

  it("rejects an unsupported event type", () => {
    expect(normalizeBridgeEvent({ ...valid, eventType: "trade.execution" }).errors.join(" ")).toMatch(/eventType/);
  });

  it("rejects a missing instrument id", () => {
    const { instrumentId, ...rest } = valid;
    void instrumentId;
    expect(normalizeBridgeEvent(rest).errors.join(" ")).toMatch(/instrumentId/);
  });

  it("rejects a missing timestamp", () => {
    const { eventTimestamp, ...rest } = valid;
    void eventTimestamp;
    expect(normalizeBridgeEvent(rest).errors.join(" ")).toMatch(/eventTimestamp/);
  });

  it("rejects a dataStatus the server will not accept from a bridge", () => {
    expect(normalizeBridgeEvent({ ...valid, dataStatus: "unavailable" }).errors.join(" ")).toMatch(/dataStatus/);
  });

  it("coerces non-numeric quote fields to null rather than 0", () => {
    const { quote } = normalizeBridgeEvent({ ...valid, bid: "not-a-number", volume: undefined });
    expect(quote?.bid).toBeNull();
    expect(quote?.volume).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(normalizeBridgeEvent("nope").errors).toHaveLength(1);
  });
});

describe("NinjaTrader depth normalization", () => {
  const validDepth = {
    schemaVersion: 1,
    eventType: "market.depth",
    provider: "ninjatrader",
    instrumentId: "inst_esz6",
    providerSymbol: "ES 03-26",
    eventTimestamp: "2026-01-01T12:00:00.000Z",
    receivedTimestamp: "2026-01-01T12:00:00.100Z",
    dataStatus: "live",
    bids: [{ price: 6200.25, volume: 12 }, { price: 6200, volume: 40 }],
    asks: [{ price: 6200.5, volume: 8 }, { price: 6200.75, volume: 25 }],
  };

  it("accepts a valid ladder", () => {
    const { depth, errors } = normalizeDepthEvent(validDepth);
    expect(errors).toHaveLength(0);
    expect(depth?.bids).toHaveLength(2);
    expect(depth?.asks[0]).toEqual({ price: 6200.5, volume: 8 });
  });

  it("accepts up to 100 levels per side and rejects 101", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ price: 6000 + i, volume: 1 }));
    expect(normalizeDepthEvent({ ...validDepth, asks: hundred }).depth?.asks).toHaveLength(100);
    const tooMany = Array.from({ length: 101 }, (_, i) => ({ price: 6000 + i, volume: 1 }));
    const { depth, errors } = normalizeDepthEvent({ ...validDepth, asks: tooMany });
    expect(depth).toBeUndefined();
    expect(errors.join(" ")).toMatch(/asks/);
  });

  it("rejects non-numeric levels", () => {
    const { depth } = normalizeDepthEvent({ ...validDepth, bids: [{ price: "x", volume: 1 }] });
    expect(depth).toBeUndefined();
  });

  it("requires at least one side array", () => {
    const skeleton = {
      schemaVersion: 1,
      eventType: "market.depth",
      instrumentId: "inst_esz6",
      eventTimestamp: validDepth.eventTimestamp,
      receivedTimestamp: validDepth.receivedTimestamp,
      dataStatus: "live",
    };
    const withAsks = normalizeDepthEvent({ ...skeleton, asks: validDepth.asks });
    expect(withAsks.depth?.asks).toHaveLength(2);
    expect(withAsks.depth?.bids).toHaveLength(0);
    const neither = normalizeDepthEvent(skeleton);
    expect(neither.depth).toBeUndefined();
    expect(neither.errors.join(" ")).toMatch(/bids and\/or asks/);
  });

  it("rejects unavailable/derived statuses", () => {
    expect(normalizeDepthEvent({ ...validDepth, dataStatus: "stale" }).errors.join(" ")).toMatch(/dataStatus/);
  });
});

describe("NinjaTrader trade normalization", () => {
  const validTrade = {
    schemaVersion: 1,
    eventType: "market.trade",
    instrumentId: "inst_esz6",
    providerSymbol: "ES 03-26",
    eventTimestamp: "2026-01-01T12:00:00.000Z",
    receivedTimestamp: "2026-01-01T12:00:00.100Z",
    dataStatus: "live",
    price: 6200.25,
    size: 7,
    side: "buy",
  };

  it("accepts a valid print", () => {
    const { trade, errors } = normalizeTradeEvent(validTrade);
    expect(errors).toHaveLength(0);
    expect(trade?.side).toBe("buy");
    expect(trade?.size).toBe(7);
  });

  it("defaults side to null (honest when the feed cannot attribute)", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { side, ...noSide } = validTrade;
    const { trade } = normalizeTradeEvent(noSide);
    expect(trade?.side).toBeNull();
  });

  it("rejects negative size and bad side", () => {
    expect(normalizeTradeEvent({ ...validTrade, size: -1 }).errors.join(" ")).toMatch(/size/);
    expect(normalizeTradeEvent({ ...validTrade, side: "up" }).errors.join(" ")).toMatch(/side/);
  });

  it("rejects non-numeric price", () => {
    expect(normalizeTradeEvent({ ...validTrade, price: null }).errors.join(" ")).toMatch(/price/);
  });
});

describe("news priority rules", () => {
  it("classifies a known macro release as high impact", () => {
    expect(derivePriority("US CPI rises 0.3% in June", { sourceKey: "reuters" }).priority).toBe("high");
  });

  it("never awards BREAKING from keywords alone", () => {
    expect(derivePriority("Emergency: markets halted", { sourceKey: "fixture" }).priority).not.toBe("breaking");
  });

  it("honours an explicit source classification", () => {
    expect(derivePriority("Something happened", { sourceKey: "financialjuice", explicit: "breaking" })).toEqual({
      priority: "breaking",
      rule: "source-classification",
    });
  });

  it("marks scheduled events as scheduled", () => {
    expect(derivePriority("FOMC decision", { sourceKey: "official", scheduled: true }).priority).toBe("scheduled");
  });
});