import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { listNews, newsCountsByPriority, type NewsPriority } from "@/lib/news/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIORITIES: NewsPriority[] = ["breaking", "high", "scheduled", "market", "research", "general"];

export const GET = handler(async (req: Request) => {
  requirePermission("news.read");
  const url = new URL(req.url);
  const priorityRaw = url.searchParams.get("priority");
  const priority = priorityRaw && PRIORITIES.includes(priorityRaw as NewsPriority)
    ? (priorityRaw as NewsPriority)
    : undefined;

  const items = listNews({
    priority,
    source: url.searchParams.get("source") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    query: url.searchParams.get("q") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 100),
  });

  const sourcesEnabled = items.some((i) => !i.is_fixture);
  return ok({
    counts: newsCountsByPriority(),
    hasRealContent: sourcesEnabled,
    items: items.map((i) => ({
      ...i,
      categories: i.categories ? i.categories.split(",") : [],
      instruments: i.instruments ? i.instruments.split(",") : [],
    })),
  });
});