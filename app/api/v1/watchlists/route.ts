import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { execute, newId, queryAll } from "@/lib/db";
import { getInstrument } from "@/lib/market/instruments";
import { buildQuoteView } from "@/lib/market/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WlRow { id: string; name: string; is_default: number }

export const GET = handler(async () => {
  const user = requirePermission("market.read");
  const lists = queryAll<WlRow>("SELECT id, name, is_default FROM watchlists WHERE user_id = ? ORDER BY is_default DESC, name", user.id);
  const items = lists.map((l) => {
    const rows = queryAll<{ instrument_id: string; sort_order: number }>(
      "SELECT instrument_id, sort_order FROM watchlist_items WHERE watchlist_id = ? ORDER BY sort_order",
      l.id,
    );
    const quotes = rows
      .map((r) => getInstrument(r.instrument_id))
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map(buildQuoteView);
    return { ...l, quotes };
  });
  return ok({ watchlists: items });
});

interface PostBody { action: "add" | "remove" | "create"; watchlistId?: string; symbol?: string; name?: string }

export const POST = handler(async (req: Request) => {
  const user = requirePermission("workspaces.write");
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const now = new Date().toISOString();

  if (body.action === "create") {
    const name = requireString(body.name, "name", 80);
    const id = newId("wl");
    execute("INSERT INTO watchlists (id, user_id, name, is_default, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)", id, user.id, name, now, now);
    return ok({ id }, { status: 201 });
  }

  const watchlistId = requireString(body.watchlistId, "watchlistId", 64);
  const owns = queryAll<{ id: string }>("SELECT id FROM watchlists WHERE id = ? AND user_id = ?", watchlistId, user.id);
  if (owns.length === 0) return fail(403, "FORBIDDEN", "Watchlist does not belong to you.");

  if (body.action === "remove") {
    const symbol = requireString(body.symbol, "symbol", 32);
    const inst = getInstrument(symbol);
    if (!inst) return fail(404, "INSTRUMENT_NOT_FOUND", `Unknown instrument: ${symbol}`);
    execute("DELETE FROM watchlist_items WHERE watchlist_id = ? AND instrument_id = ?", watchlistId, inst.id);
    return ok({ removed: symbol });
  }

  // add
  const symbol = requireString(body.symbol, "symbol", 32);
  const inst = getInstrument(symbol);
  if (!inst) return fail(404, "INSTRUMENT_NOT_FOUND", `Unknown instrument: ${symbol}`);
  execute("INSERT OR IGNORE INTO watchlist_items (watchlist_id, instrument_id, sort_order) VALUES (?, ?, 0)", watchlistId, inst.id);
  execute("UPDATE watchlists SET updated_at = ? WHERE id = ?", now, watchlistId);
  return ok({ added: symbol });
});