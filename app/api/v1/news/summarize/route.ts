import { handler, ok } from "@/lib/api/respond";
import { HttpError, requirePermission } from "@/lib/auth/current";
import { AiUnavailableError, aiStatus, summarizeStory } from "@/lib/news/ai";
import { getNewsStory } from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const user = requirePermission("news.read");
  if (!aiStatus().enabled) {
    return ok({ enabled: false, reason: aiStatus().reason });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid JSON body.");
  }
  const storyId = body && typeof body === "object" && typeof (body as { storyId?: unknown }).storyId === "string"
    ? (body as { storyId: string }).storyId.slice(0, 80)
    : "";
  if (!storyId) throw new HttpError(400, "VALIDATION_ERROR", "storyId is required.");

  const story = getNewsStory(storyId, user.id);
  if (!story) throw new HttpError(404, "NOT_FOUND", "Story not found.");

  try {
    const result = await summarizeStory(story);
    return ok({ enabled: true, storyId, ...result });
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      if (error.code === "AI_DISABLED") return ok({ enabled: false, reason: error.message });
      throw new HttpError(error.code === "NO_SOURCE_TEXT" ? 422 : 502, error.code, error.message);
    }
    throw error;
  }
});
