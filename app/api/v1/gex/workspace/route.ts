import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import {
  buildGexComparison,
  buildGexProfile,
  buildGexSurface,
  GEX_UNIT_OPTIONS,
  gexUnitLabel,
  type GexProfile,
  type GexUnit,
} from "@/lib/finance/gex-workspace";
import { DEALER_SIGN_ASSUMPTION, GEX_MODEL_VERSION } from "@/lib/finance/gex";
import {
  loadOptionsChain,
  OPTIONS_PROVIDER_REQUIREMENT,
  OPTIONS_SYMBOLS,
  selectExpiration,
  type LoadedOptionsChain,
} from "@/lib/market/options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNITS = new Set<GexUnit>(GEX_UNIT_OPTIONS.map((u) => u.value));

function param(req: Request, key: string): string | null {
  const value = new URL(req.url).searchParams.get(key);
  return value && value.length > 0 ? value : null;
}

function intParam(req: Request, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(param(req, key));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function profileFor(chain: LoadedOptionsChain, expiration: string | null, unit: GexUnit): GexProfile | null {
  if (!chain.available || !chain.spot || !expiration) return null;
  return buildGexProfile(
    {
      symbol: chain.symbol,
      spot: chain.spot,
      contractMultiplier: chain.contractMultiplier,
      expiration,
      asOf: chain.asOf ?? new Date().toISOString(),
      contracts: chain.contracts,
    },
    unit,
  );
}

function side(chain: LoadedOptionsChain, expiration: string | null) {
  return {
    symbol: chain.symbol,
    available: chain.available,
    reason: chain.reason,
    source: chain.source,
    sourceLabel: chain.sourceLabel,
    dataStatus: chain.dataStatus,
    asOf: chain.asOf,
    spot: chain.spot,
    contractMultiplier: chain.contractMultiplier,
    expiration,
    expirations: chain.expirations,
    warnings: chain.warnings,
  };
}

export const GET = handler(async (req: Request) => {
  requirePermission("analytics.read");

  const symbolA = (param(req, "symbolA") ?? "SPY").toUpperCase();
  const symbolB = (param(req, "symbolB") ?? symbolA).toUpperCase();
  const requestedUnit = (param(req, "unit") ?? "usd_per_1pct") as GexUnit;
  const unit: GexUnit = UNITS.has(requestedUnit) ? requestedUnit : "usd_per_1pct";
  const rangePercent = intParam(req, "range", 10, 0, 50);
  const expirationLimit = intParam(req, "expirations", 6, 2, 8);

  const chainA = await loadOptionsChain(symbolA);
  const chainB = symbolB === symbolA ? chainA : await loadOptionsChain(symbolB);

  const expA = selectExpiration(chainA, param(req, "expA"), 0);
  const expB = selectExpiration(
    chainB,
    param(req, "expB"),
    chainB === chainA ? 1 : 0,
  );

  const a = profileFor(chainA, expA, unit);
  const b = profileFor(chainB, expB, unit);
  const comparison = a && b ? buildGexComparison(a, b) : null;

  const surfaceExpirations = chainA.expirations.slice(0, expirationLimit);
  const surfaceProfiles = surfaceExpirations
    .map((e) => profileFor(chainA, e.expiration, unit))
    .filter((p): p is GexProfile => p !== null);
  const surface = chainA.available && chainA.spot && surfaceProfiles.length > 0
    ? buildGexSurface(chainA.symbol, chainA.spot, surfaceProfiles, { strikeWindowPct: rangePercent })
    : null;

  const available = Boolean(a && b);
  const reasons = [chainA, chainB]
    .filter((c) => !c.available && c.reason)
    .map((c) => c.reason)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  return ok({
    available,
    reason: available ? null : reasons.join(" · ") || "No options chain is available.",
    providerRequirement: OPTIONS_PROVIDER_REQUIREMENT,
    modelVersion: GEX_MODEL_VERSION,
    assumption: DEALER_SIGN_ASSUMPTION,
    unit,
    unitLabel: gexUnitLabel(unit),
    units: GEX_UNIT_OPTIONS,
    rangePercent,
    expirationLimit,
    supportedSymbols: OPTIONS_SYMBOLS,
    sides: { a: side(chainA, expA), b: side(chainB, expB) },
    a,
    b,
    comparison,
    surface,
  });
});
