import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { listInstruments } from "@/lib/market/instruments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("market.read");
  const url = new URL(req.url);
  const assetClass = url.searchParams.get("assetClass") ?? undefined;
  const q = (url.searchParams.get("q") ?? "").toLowerCase();

  let instruments = listInstruments(assetClass);
  if (q) {
    instruments = instruments.filter(
      (i) => i.symbol.toLowerCase().includes(q) || i.display_name.toLowerCase().includes(q),
    );
  }
  return ok({ count: instruments.length, instruments });
});