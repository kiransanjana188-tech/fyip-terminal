import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { listInstruments } from "@/lib/market/instruments";
import { buildQuoteViewList, type QuoteView } from "@/lib/market/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SortKey = "changePct" | "last" | "volume" | "symbol";

/**
 * Server-side screener over the live quote set. Filter definitions are reusable
 * and can be persisted client-side / per-user. Only instruments with an actual
 * quote (non-null last) are returned.
 */
export const GET = handler(async (req: Request) => {
  requirePermission("research.read");
  const p = new URL(req.url).searchParams;
  const num = (k: string) => (p.get(k) !== null && p.get(k) !== "" ? Number(p.get(k)) : null);

  const assetClass = p.get("assetClass") ?? undefined;
  const minLast = num("minLast");
  const maxLast = num("maxLast");
  const minChangePct = num("minChangePct");
  const maxChangePct = num("maxChangePct");
  const minVolume = num("minVolume");
  const sortBy = (p.get("sortBy") as SortKey) ?? "changePct";
  const dir = p.get("dir") === "asc" ? 1 : -1;
  const query = (p.get("q") ?? "").toLowerCase();

  let views = buildQuoteViewList(listInstruments(assetClass)).filter((v) => v.last !== null);

  if (minLast !== null) views = views.filter((v) => (v.last ?? 0) >= minLast);
  if (maxLast !== null) views = views.filter((v) => (v.last ?? 0) <= maxLast);
  if (minChangePct !== null) views = views.filter((v) => (v.changePct ?? -Infinity) >= minChangePct);
  if (maxChangePct !== null) views = views.filter((v) => (v.changePct ?? Infinity) <= maxChangePct);
  if (minVolume !== null) views = views.filter((v) => (v.volume ?? 0) >= minVolume);
  if (query) {
    views = views.filter((v) => v.symbol.toLowerCase().includes(query) || v.displayName.toLowerCase().includes(query));
  }

  const key = (v: QuoteView): number | string => {
    if (sortBy === "symbol") return v.symbol;
    if (sortBy === "last") return v.last ?? 0;
    if (sortBy === "volume") return v.volume ?? 0;
    return v.changePct ?? 0;
  };
  views.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (typeof ka === "string" || typeof kb === "string") return String(ka).localeCompare(String(kb)) * dir;
    return (ka - kb) * dir;
  });

  return ok({ count: views.length, of: listInstruments(assetClass).length, results: views.slice(0, 300) });
});