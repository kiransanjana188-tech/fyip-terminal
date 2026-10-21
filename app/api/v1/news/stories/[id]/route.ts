import { handler, ok } from "@/lib/api/respond";
import { HttpError, requirePermission } from "@/lib/auth/current";
import { aiStatus } from "@/lib/news/ai";
import { NEWS_DISCLAIMER, NEWS_METHODOLOGY } from "@/lib/news/pipeline";
import { getClusterStories, getNewsStory, listNewsSourceHealth } from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (_req: Request, context: { params: { id: string } }) => {
  const user = requirePermission("news.read");
  const id = context.params.id?.slice(0, 80);
  if (!id) throw new HttpError(400, "VALIDATION_ERROR", "Story id is required.");

  const story = getNewsStory(id, user.id);
  if (!story) throw new HttpError(404, "NOT_FOUND", "Story not found.");

  const related = getClusterStories(story.clusterId, story.id, user.id, 10);
  const sourceKeys = new Set([story.providerKey, ...related.map((item) => item.providerKey)]);
  const sources = listNewsSourceHealth().filter((source) => sourceKeys.has(source.key));

  return ok({
    story,
    related,
    sources,
    ai: aiStatus(),
    methodology: NEWS_METHODOLOGY,
    disclaimer: NEWS_DISCLAIMER,
  });
});
