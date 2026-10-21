import { describe, it, expect } from "vitest";
import { nextQuarterlyContracts, symbolForContract } from "../lib/market/instruments";

describe("futures contract metadata", () => {
  it("computes the third Friday of the contract month", () => {
    const c = nextQuarterlyContracts(new Date("2026-10-19T00:00:00Z"), 2);
    expect(c[0]).toMatchObject({ month: 12, year: 2026, expiration: "2026-12-18" });
    expect(c[1]).toMatchObject({ month: 3, year: 2027, expiration: "2027-03-19" });
  });

  it("rolls into the next year correctly", () => {
    const c = nextQuarterlyContracts(new Date("2026-12-20T00:00:00Z"), 3);
    expect(c.map((x) => `${x.month}/${x.year}`)).toEqual(["3/2027", "6/2027", "9/2027"]);
  });

  it("builds provider contract symbols", () => {
    expect(symbolForContract("ES", 12, 2026)).toBe("ESZ6");
    expect(symbolForContract("NQ", 3, 2027)).toBe("NQH7");
    expect(symbolForContract("GC", 6, 2025)).toBe("GCM5");
  });
});