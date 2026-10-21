import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll } from "@/lib/db";
import { providerSummaries } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfigRow {
  provider_key: string;
  kind: string;
  enabled: number;
  entitlement: string | null;
  notes: string | null;
}

export const GET = handler(async () => {
  requirePermission("market.read");
  const configs = queryAll<ConfigRow>("SELECT provider_key, kind, enabled, entitlement, notes FROM data_provider_configs");
  const byKey = new Map(configs.map((c) => [c.provider_key, c]));
  const providers = providerSummaries().map((p) => ({
    ...p,
    enabledInDb: !!byKey.get(p.key)?.enabled,
  }));
  return ok({ providers });
});