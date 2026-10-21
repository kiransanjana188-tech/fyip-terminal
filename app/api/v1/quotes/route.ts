import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { getInstrument, listInstruments } from "@/lib/market/instruments";
import { buildQuoteView, buildQuoteViewList } from "@/lib/market/quotes";
import { bridgeThresholds } from "@/lib/market/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("market.read");
  const url = new URL(req.url);
  const symbolsParam = url.searchParams.get("symbols");
  const assetClass = url.searchParams.get("assetClass") ?? undefined;

  let quotes;
  if (symbolsParam) {
    const symbols = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
    quotes = symbols
      .map((s) => getInstrument(s))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map(buildQuoteView);
  } else {
    quotes = buildQuoteViewList(listInstruments(assetClass));
  }

  return ok({ asOf: new Date().toISOString(), thresholds: bridgeThresholds(), count: quotes.length, quotes });
});