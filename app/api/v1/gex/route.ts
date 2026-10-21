import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { computeGex, DEALER_SIGN_ASSUMPTION, GEX_MODEL_VERSION, type GexContractInput } from "@/lib/finance/gex";
import { getInstrument } from "@/lib/market/instruments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Model metadata for the GEX workspace, regardless of input availability. */
export const GET = handler(async (req: Request) => {
  requirePermission("analytics.read");
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "SPY";
  const inst = getInstrument(symbol);
  return ok({
    modelVersion: GEX_MODEL_VERSION,
    assumption: DEALER_SIGN_ASSUMPTION,
    unit: "dollar gamma per 1% underlying move",
    available: false,
    reason: "GEX requires an options chain (strikes, open interest, gammas/IV). Connect an options provider, or POST contracts to compute a reproducible model result.",
    underlying: inst ? { symbol: inst.symbol, id: inst.id, multiplier: inst.contract_multiplier } : null,
  });
});

interface Body {
  spot?: number;
  contractMultiplier?: number;
  asOf?: string;
  riskFreeRate?: number;
  timeToExpiryYears?: number;
  contracts?: GexContractInput[];
}

/**
 * Compute a reproducible GEX result from supplied contract-level inputs.
 * This is deterministic FYIP computation on caller-provided data — it does not
 * invent open interest or gammas.
 */
export const POST = handler(async (req: Request) => {
  requirePermission("analytics.read");
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  if (typeof b.spot !== "number" || b.spot <= 0) return fail(400, "VALIDATION_ERROR", "spot must be a positive number.");
  if (!Array.isArray(b.contracts) || b.contracts.length === 0) return fail(400, "VALIDATION_ERROR", "contracts[] is required.");
  if (b.contracts.length > 20000) return fail(413, "TOO_MANY_CONTRACTS", "At most 20000 contracts per request.");

  const result = computeGex({
    spot: b.spot,
    contractMultiplier: b.contractMultiplier ?? 100,
    asOf: b.asOf ?? new Date().toISOString(),
    riskFreeRate: b.riskFreeRate,
    timeToExpiryYears: b.timeToExpiryYears,
    contracts: b.contracts,
  });
  return ok(result);
});