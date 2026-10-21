import { fail, handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll, queryOne } from "@/lib/db";
import { getInstrument } from "@/lib/market/instruments";
import { buildQuoteView } from "@/lib/market/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, ctx: { params: { symbol: string } }) => {
  requirePermission("research.read");
  const inst = getInstrument(ctx.params.symbol);
  if (!inst) return fail(404, "INSTRUMENT_NOT_FOUND", `Unknown instrument: ${ctx.params.symbol}`);

  const profile = queryOne<Record<string, unknown>>(
    "SELECT * FROM company_profiles WHERE instrument_id = ?",
    inst.id,
  );
  const financials = queryAll<Record<string, unknown>>(
    "SELECT statement, line_item, period, period_type, value, unit, currency, source, filed_at FROM company_financials WHERE instrument_id = ? ORDER BY period DESC",
    inst.id,
  );
  const filings = queryAll<Record<string, unknown>>(
    "SELECT id, form_type, title, filed_at, period, url, source FROM filings WHERE instrument_id = ? ORDER BY filed_at DESC LIMIT 100",
    inst.id,
  );

  return ok({
    instrument: inst,
    quote: buildQuoteView(inst),
    profile: profile ?? null,
    financials,
    financialsAvailable: financials.length > 0,
    financialsBlocker: financials.length === 0 ? "Connect a fundamentals provider to load statements." : null,
    filings,
    filingsBlocker: filings.length === 0 ? "Connect SEC EDGAR / a filings provider to load documents." : null,
  });
});