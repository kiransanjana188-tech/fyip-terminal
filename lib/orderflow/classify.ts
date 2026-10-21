export type ProviderTradeSide = "buy" | "sell" | "cross" | null;
export type AggressorSide = ProviderTradeSide;
export type SideSource = "provider" | "inferred" | "unknown";

export function inferAggressor(
  price: number,
  bid: number | null | undefined,
  ask: number | null | undefined,
): "buy" | "sell" | null {
  const hasBid = bid !== null && bid !== undefined && Number.isFinite(bid);
  const hasAsk = ask !== null && ask !== undefined && Number.isFinite(ask);
  if (!hasBid && !hasAsk) return null;
  if (hasBid && hasAsk && (bid as number) > (ask as number)) return null;
  if (hasBid && price <= (bid as number)) return "sell";
  if (hasAsk && price >= (ask as number)) return "buy";
  return null;
}

export function classifyTradeSide(
  providerSide: ProviderTradeSide,
  price: number,
  bid: number | null | undefined,
  ask: number | null | undefined,
): { side: AggressorSide; sideSource: SideSource } {
  if (providerSide === "buy" || providerSide === "sell" || providerSide === "cross") {
    return { side: providerSide, sideSource: "provider" };
  }
  const inferred = inferAggressor(price, bid, ask);
  if (inferred) return { side: inferred, sideSource: "inferred" };
  return { side: null, sideSource: "unknown" };
}
