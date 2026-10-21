import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { lastNewsCollectionAt } from "@/lib/news/ingest";
import { NEWS_DISCLAIMER, NEWS_METHODOLOGY } from "@/lib/news/pipeline";
import {
  listNewsStories,
  newsCounts,
  newsSourceFacets,
  type StoryListFilters,
} from "@/lib/news/store";
import { CATEGORY_ORDER, REGION_ORDER } from "@/lib/news/taxonomy";
import type { NewsCategory, NewsPriority } from "@/lib/news/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIORITIES: NewsPriority[] = ["breaking", "high", "scheduled", "market", "research", "general"];
const SORTS: StoryListFilters["sort"][] = ["newest", "published", "priority", "relevance"];

export const GET = handler(async (req: Request) => {
  const user = requirePermission("news.read");
  const params = new URL(req.url).searchParams;

  const categoryRaw = params.get("category");
  const regionRaw = params.get("region");
  const priorityRaw = params.get("priority");
  const sortRaw = params.get("sort");

  const filters: StoryListFilters = {
    category: categoryRaw && CATEGORY_ORDER.includes(categoryRaw as NewsCategory)
      ? (categoryRaw as NewsCategory)
      : undefined,
    region: regionRaw && REGION_ORDER.includes(regionRaw as (typeof REGION_ORDER)[number])
      ? regionRaw
      : undefined,
    provider: params.get("provider") ?? undefined,
    priority: priorityRaw && PRIORITIES.includes(priorityRaw as NewsPriority)
      ? (priorityRaw as NewsPriority)
      : undefined,
    breakingOnly: params.get("breaking") === "1",
    savedOnly: params.get("saved") === "1",
    search: params.get("q")?.slice(0, 80) || undefined,
    sinceHours: params.get("sinceHours") ? Number(params.get("sinceHours")) : undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : 60,
    offset: params.get("offset") ? Number(params.get("offset")) : 0,
    sort: sortRaw && SORTS.includes(sortRaw as StoryListFilters["sort"])
      ? (sortRaw as StoryListFilters["sort"])
      : "newest",
  };

  const result = listNewsStories(filters, user.id);
  return ok({
    ...result,
    counts: newsCounts(user.id),
    sources: newsSourceFacets(),
    hasRealContent: result.total > 0,
    lastCollectionAt: lastNewsCollectionAt(),
    generatedAt: new Date().toISOString(),
    methodology: NEWS_METHODOLOGY,
    disclaimer: NEWS_DISCLAIMER,
  });
});
