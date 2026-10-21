import { fail, handler, ok, requireString } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { execute, queryAll } from "@/lib/db";
import { providerSummaries } from "@/lib/providers/registry";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  requirePermission("admin.providers");
  const configs = queryAll<{ provider_key: string; kind: string; enabled: number; entitlement: string | null; notes: string | null }>(
    "SELECT provider_key, kind, enabled, entitlement, notes FROM data_provider_configs",
  );
  const summaries = providerSummaries();
  const merged = summaries.map((s) => {
    const cfg = configs.find((c) => c.provider_key === s.key);
    return { ...s, enabledInDb: !!cfg?.enabled, dbEntitlement: cfg?.entitlement ?? null, notes: cfg?.notes ?? null };
  });
  return ok({ providers: merged });
});

export const PATCH = handler(async (req: Request) => {
  const user = requirePermission("admin.providers");
  const body = (await req.json().catch(() => null)) as { key?: string; enabled?: boolean } | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");
  const key = requireString(body.key, "key", 64);
  const enabled = !!body.enabled;
  execute("UPDATE data_provider_configs SET enabled = ?, updated_at = ? WHERE provider_key = ?", enabled ? 1 : 0, new Date().toISOString(), key);
  recordAudit({ actorId: user.id, actorEmail: user.email, action: "admin.provider.toggle", target: key, status: "success", detail: { enabled } });
  return ok({ key, enabled });
});