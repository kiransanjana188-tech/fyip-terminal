import { describe, it, expect } from "vitest";
import { deriveDataStatus } from "../lib/market/status";

const thresholds = { staleSeconds: 8, disconnectSeconds: 30 };
const now = new Date("2026-01-01T12:00:00Z").getTime();
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

describe("data status derivation", () => {
  it("passes through intrinsic statuses", () => {
    expect(deriveDataStatus({ declared: "simulated", connected: true, ...thresholds })).toBe("simulated");
    expect(deriveDataStatus({ declared: "historical", connected: true, ...thresholds })).toBe("historical");
    expect(deriveDataStatus({ declared: "delayed", connected: true, ...thresholds })).toBe("delayed");
  });

  it("marks disconnected when the feed is down", () => {
    expect(deriveDataStatus({ declared: "live", connected: false, eventTimestamp: at(0), ...thresholds })).toBe("disconnected");
  });

  it("marks live for a recent connected event", () => {
    expect(deriveDataStatus({ declared: "live", connected: true, eventTimestamp: at(1), ...thresholds, now })).toBe("live");
  });

  it("marks stale after the stale threshold but before disconnect", () => {
    expect(deriveDataStatus({ declared: "live", connected: true, eventTimestamp: at(15), ...thresholds, now })).toBe("stale");
  });

  it("marks disconnected after the disconnect threshold", () => {
    expect(deriveDataStatus({ declared: "live", connected: true, eventTimestamp: at(45), ...thresholds, now })).toBe("disconnected");
  });

  it("never promotes an old quote to live", () => {
    // A 5-minute-old quote must not read as LIVE just because we received it now.
    expect(deriveDataStatus({ declared: "live", connected: true, eventTimestamp: at(300), receivedTimestamp: at(0), ...thresholds, now })).toBe("disconnected");
  });
});