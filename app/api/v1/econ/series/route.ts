import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { economicIndicators, listObservations } from "@/lib/econ/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("news.read");
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const indicator = url.searchParams.get("indicator");

  if (!country || !indicator) {
    return ok({ indicators: economicIndicators(), series: [] });
  }
  const series = listObservations(country, indicator, Number(url.searchParams.get("limit") ?? 200));
  if (series.length === 0) {
    return fail(404, "SERIES_NOT_FOUND", `No observations for ${country}/${indicator}. Configure a macro provider (e.g. FRED).`);
  }
  return ok({ country, indicator, series });
});