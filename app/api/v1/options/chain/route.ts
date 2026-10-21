import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll } from "@/lib/db";
import { getInstrument } from "@/lib/market/instruments";
import { getOptionsProvider } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("analytics.read");
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "SPY";
  const inst = getInstrument(symbol);
  if (!inst) return ok({ available: false, reason: `Unknown instrument: ${symbol}`, chain: [] });

  // Provider-supplied chain when an options provider is configured.
  const provider = getOptionsProvider("polygon");
  if (provider?.isConfigured()) {
    try {
      const chain = await provider.fetchChain(inst.id);
      return ok({ available: true, source: provider.key, greeksSource: "provider", chain });
    } catch (err) {
      // Fall through to stored snapshots / unavailable.
      void err;
    }
  }

  // Any previously ingested option snapshots for this underlying.
  const stored = queryAll<Record<string, unknown>>(
    "SELECT expiration, strike, option_type, bid, ask, last, volume, open_interest, implied_vol, delta, gamma, theta, vega, rho, greeks_source, underlying_price, source, as_of FROM options_snapshots WHERE underlying_id = ? ORDER BY expiration, strike",
    inst.id,
  );
  if (stored.length > 0) {
    return ok({ available: true, source: "stored", greeksSource: "mixed", chain: stored });
  }

  return ok({
    available: false,
    underlying: { symbol: inst.symbol, id: inst.id },
    reason: "No options data provider is configured. Connect an options-enabled vendor (e.g. Polygon with an options plan) or feed snapshots via the bridge.",
    calculatorAvailable: true,
    calculatorNote: "Use the FYIP Black-Scholes calculator below to price a single contract. FYIP-computed Greeks are always labelled as calculated.",
  });
});