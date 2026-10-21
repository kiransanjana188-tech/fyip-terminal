import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { hasRealMacroData, listEconomicEvents } from "@/lib/econ/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("news.read");
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const country = url.searchParams.get("country") ?? undefined;

  const events = listEconomicEvents({ from, to, country, limit: Number(url.searchParams.get("limit") ?? 200) });
  return ok({
    hasRealData: hasRealMacroData(),
    fixturesIncluded: events.some((e) => e.is_fixture === 1),
    events,
  });
});