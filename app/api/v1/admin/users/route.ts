import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { execute, queryAll, queryOne } from "@/lib/db";
import { ROLE_DEFINITIONS, type RoleKey } from "@/lib/auth/rbac";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UserRow { id: string; email: string; display_name: string; status: string; created_at: string }

export const GET = handler(async () => {
  requirePermission("admin.users");
  const users = queryAll<UserRow>("SELECT id, email, display_name, status, created_at FROM users ORDER BY created_at");
  const withRoles = users.map((u) => ({
    ...u,
    roles: queryAll<{ key: string }>(
      "SELECT r.key AS key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?",
      u.id,
    ).map((r) => r.key),
  }));
  return ok({ users: withRoles, availableRoles: Object.keys(ROLE_DEFINITIONS) });
});

interface PatchBody { userId?: string; role?: RoleKey; enabled?: boolean }

export const PATCH = handler(async (req: Request) => {
  const admin = requirePermission("admin.users");
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const userId = requireString(body.userId, "userId", 64);
  const target = queryOne<{ id: string }>("SELECT id FROM users WHERE id = ?", userId);
  if (!target) return fail(404, "USER_NOT_FOUND", "Unknown user.");

  if (typeof body.enabled === "boolean") {
    execute("UPDATE users SET status = ?, updated_at = ? WHERE id = ?", body.enabled ? "active" : "disabled", new Date().toISOString(), userId);
    recordAudit({ actorId: admin.id, action: "admin.user.status", target: userId, status: "success", detail: { enabled: body.enabled } });
  }

  if (body.role) {
    const key = body.role;
    if (!(key in ROLE_DEFINITIONS)) return fail(400, "VALIDATION_ERROR", "Unknown role.");
    execute("DELETE FROM user_roles WHERE user_id = ?", userId);
    execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)", userId, `role_${key}`);
    recordAudit({ actorId: admin.id, action: "admin.user.role", target: userId, status: "success", detail: { role: key } });
  }

  return ok({ userId, updated: true });
});