import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { createAlert, evaluateAlertsForUser, listAlerts, recentAlertEvents, type AlertKind, type AlertOp } from "@/lib/alerts/engine";
import { execute } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: AlertKind[] = ["quote_threshold", "pct_change", "feed_down", "news_keyword", "economic_reminder"];
const OPS: AlertOp[] = ["gt", "lt", "gte", "lte"];

export const GET = handler(async () => {
  const user = requirePermission("alerts.write");
  const fired = evaluateAlertsForUser(user.id);
  return ok({ alerts: listAlerts(user.id), events: recentAlertEvents(user.id), firedNow: fired });
});

interface PostBody {
  action?: "create" | "delete";
  id?: string;
  name?: string;
  kind?: AlertKind;
  target?: string;
  op?: AlertOp;
  value?: number;
  field?: "last" | "bid" | "ask" | "volume";
  pct?: boolean;
}

export const POST = handler(async (req: Request) => {
  const user = requirePermission("alerts.write");
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");

  if (body.action === "delete") {
    const id = requireString(body.id, "id", 64);
    execute("DELETE FROM alerts WHERE id = ? AND user_id = ?", id, user.id);
    recordAudit({ actorId: user.id, action: "alerts.delete", target: id, status: "success" });
    return ok({ deleted: id });
  }

  const name = requireString(body.name, "name", 120);
  const kind = body.kind ?? "quote_threshold";
  if (!KINDS.includes(kind)) return fail(400, "VALIDATION_ERROR", "Unknown alert kind.");
  const op = body.op ?? "gt";
  if (!OPS.includes(op)) return fail(400, "VALIDATION_ERROR", "Unknown operator.");
  const value = typeof body.value === "number" ? body.value : Number(body.value);
  if (!Number.isFinite(value)) return fail(400, "VALIDATION_ERROR", "value must be a number.");

  const id = createAlert({
    userId: user.id,
    name,
    kind,
    target: body.target ?? null,
    condition: { op, value, field: body.field ?? "last", pct: body.pct ?? kind === "pct_change" },
  });
  recordAudit({ actorId: user.id, action: "alerts.create", target: id, status: "success" });
  return ok({ id }, { status: 201 });
});