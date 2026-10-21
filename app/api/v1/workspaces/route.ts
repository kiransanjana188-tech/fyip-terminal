import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { execute, newId, queryAll, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WsRow { id: string; name: string; is_default: number; layout: string; updated_at: string }

export const GET = handler(async () => {
  const user = requirePermission("market.read");
  const rows = queryAll<WsRow>("SELECT id, name, is_default, layout, updated_at FROM workspaces WHERE user_id = ? ORDER BY updated_at DESC", user.id);
  return ok({
    workspaces: rows.map((r) => ({
      id: r.id, name: r.name, isDefault: !!r.is_default, updatedAt: r.updated_at,
      layout: safeParse(r.layout),
    })),
  });
});

interface PostBody { action?: "save" | "delete"; id?: string; name?: string; layout?: unknown; isDefault?: boolean }

export const POST = handler(async (req: Request) => {
  const user = requirePermission("workspaces.write");
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const now = new Date().toISOString();

  if (body.action === "delete") {
    const id = requireString(body.id, "id", 64);
    execute("DELETE FROM workspaces WHERE id = ? AND user_id = ?", id, user.id);
    return ok({ deleted: id });
  }

  const name = requireString(body.name, "name", 120);
  const layout = JSON.stringify(body.layout ?? { panels: [] });
  if (body.isDefault) execute("UPDATE workspaces SET is_default = 0 WHERE user_id = ?", user.id);

  const existing = body.id ? queryOne<{ id: string }>("SELECT id FROM workspaces WHERE id = ? AND user_id = ?", body.id, user.id) : undefined;
  if (existing) {
    execute("UPDATE workspaces SET name = ?, layout = ?, is_default = ?, updated_at = ? WHERE id = ?", name, layout, body.isDefault ? 1 : 0, now, existing.id);
    return ok({ id: existing.id, updated: true });
  }
  const id = newId("ws");
  execute("INSERT INTO workspaces (id, user_id, name, is_default, layout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, user.id, name, body.isDefault ? 1 : 0, layout, now, now);
  return ok({ id, updated: false }, { status: 201 });
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return { panels: [] }; }
}