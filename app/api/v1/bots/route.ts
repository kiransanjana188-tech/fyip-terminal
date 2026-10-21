import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { execute, newId, queryAll } from "@/lib/db";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * FYP Bot monitor — READ-ONLY by default. Remote execution is disabled unless a
 * bot is explicitly registered with exec_enabled; even then, commands require
 * authenticated, audited, replay-protected transport (Phase 6). This build never
 * exposes broker credentials or OS automation ports to the web tier.
 */
export const GET = handler(async () => {
  const user = requirePermission("bots.read");
  const bots = queryAll<Record<string, unknown>>(
    "SELECT id, label, platform, strategy, version, enabled, exec_enabled, last_heartbeat, state, metadata, created_at FROM bot_connections WHERE user_id = ?",
    user.id,
  );
  const withEvents = bots.map((b) => ({
    ...b,
    events: queryAll(
      "SELECT id, at, level, event_type, message FROM bot_events WHERE bot_id = ? ORDER BY at DESC LIMIT 50",
      String(b.id),
    ),
  }));
  return ok({
    executionEnabled: false,
    executionNote: "Remote start/stop controls are disabled in this build. Bot monitoring is read-only.",
    bots: withEvents,
  });
});

export const POST = handler(async (req: Request) => {
  const user = requirePermission("bots.control");
  const body = (await req.json().catch(() => null)) as { label?: string; platform?: string; strategy?: string; version?: string } | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const label = requireString(body.label, "label", 120);
  const platform = requireString(body.platform, "platform", 40);
  const id = newId("bot");
  execute(
    `INSERT INTO bot_connections (id, user_id, label, platform, strategy, version, enabled, exec_enabled, last_heartbeat, state, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL, 'registered', NULL, ?)`,
    id, user.id, label, platform, body.strategy ?? null, body.version ?? null, new Date().toISOString(),
  );
  recordAudit({ actorId: user.id, action: "bots.register", target: id, status: "success" });
  return ok({ id }, { status: 201 });
});