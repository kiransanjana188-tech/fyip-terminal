import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { blackScholes, impliedVolatility, intrinsicValue, type OptionType } from "@/lib/finance/options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  spot?: number;
  strike?: number;
  timeToExpiry?: number;
  rate?: number;
  vol?: number;
  type?: OptionType;
  dividendYield?: number;
  /** Optional market price: when supplied, FYIP also solves implied vol. */
  marketPrice?: number;
}

/**
 * FYIP Black-Scholes calculator. All outputs are FYIP-calculated and labelled
 * as such. Conventions: T in years, rate/vol/dividend as decimals.
 */
export const POST = handler(async (req: Request) => {
  requirePermission("analytics.read");
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const type: OptionType = b.type === "put" ? "put" : "call";
  const nums = ["spot", "strike", "timeToExpiry", "rate", "vol"] as const;
  for (const k of nums) {
    if (typeof b[k] !== "number" || !Number.isFinite(b[k])) {
      return fail(400, "VALIDATION_ERROR", `${k} must be a number.`);
    }
  }

  const greeks = blackScholes({
    spot: b.spot!, strike: b.strike!, timeToExpiry: b.timeToExpiry!, rate: b.rate!, vol: b.vol!, type,
    dividendYield: b.dividendYield ?? 0,
  });
  if (!greeks) return fail(422, "DEGENERATE_INPUT", "Spot, strike, T and vol must all be positive.");

  const iv = typeof b.marketPrice === "number"
    ? impliedVolatility(b.marketPrice, { spot: b.spot!, strike: b.strike!, timeToExpiry: b.timeToExpiry!, rate: b.rate!, type, dividendYield: b.dividendYield ?? 0 })
    : null;

  return ok({
    greeksSource: "fyip_calculated",
    conventions: "T in years; rate/vol/dividend as decimals; vega per 1.00 vol; theta per calendar day.",
    intrinsic: intrinsicValue(b.spot!, b.strike!, type),
    extrinsic: greeks.price - intrinsicValue(b.spot!, b.strike!, type),
    greeks,
    impliedVol: iv,
  });
});