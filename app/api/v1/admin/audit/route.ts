import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  requirePermission("admin.audit");
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 200), 1), 1000);
  const action = url.searchParams.get("action");
  const rows = action
    ? queryAll("SELECT * FROM audit_logs WHERE action LIKE ? ORDER BY at DESC LIMIT ?", `%${action}%`, limit)
    : queryAll("SELECT * FROM audit_logs ORDER BY at DESC LIMIT ?", limit);
  return ok({ logs: rows });
});