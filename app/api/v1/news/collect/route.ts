import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { isPostgres } from "@/lib/db";
import { collectDueNewsSources } from "@/lib/news/ingest";
import { getNewsSettings, newsCounts } from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual refresh. The same collector also runs from the SSE stream while a
 * client is connected. Per-source backoff keeps refresh spam from hammering
 * upstream providers.
 */
export const POST = handler(async () => {
  const user = requirePermission("news.read");
  const summary = await collectDueNewsSources({
    maxSources: isPostgres() ? 2 : 4,
    budgetMs: isPostgres() ? 8_000 : 20_000,
    triggeredBy: "manual",
  });
  return ok({
    ...summary,
    counts: newsCounts(user.id),
    collectionEnabled: getNewsSettings().collectionEnabled,
    mode: isPostgres() ? "request-triggered" : "interval+request",
  });
});
