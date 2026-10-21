import { handler, ok } from "@/lib/api/respond";
import { HttpError, requirePermission } from "@/lib/auth/current";
import { listNewsStories, setStorySaved } from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = requirePermission("news.read");
  const result = listNewsStories({ savedOnly: true, limit: 200, sort: "newest" }, user.id);
  return ok({ items: result.stories, total: result.total });
});

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "VALIDATION_ERROR", "Expected a JSON object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid JSON body.");
  }
}

export const POST = handler(async (req: Request) => {
  const user = requirePermission("news.save");
  const body = await readBody(req);
  const storyId = typeof body.storyId === "string" ? body.storyId.slice(0, 80) : "";
  if (!storyId) throw new HttpError(400, "VALIDATION_ERROR", "storyId is required.");
  const saved = body.saved === false ? false : true;
  if (!setStorySaved(user.id, storyId, saved)) {
    throw new HttpError(404, "NOT_FOUND", "Story not found.");
  }
  return ok({ storyId, saved });
});

export const DELETE = handler(async (req: Request) => {
  const user = requirePermission("news.save");
  const storyId = new URL(req.url).searchParams.get("storyId")?.slice(0, 80);
  if (!storyId) throw new HttpError(400, "VALIDATION_ERROR", "storyId is required.");
  if (!setStorySaved(user.id, storyId, false)) {
    throw new HttpError(404, "NOT_FOUND", "Story not found.");
  }
  return ok({ storyId, saved: false });
});
