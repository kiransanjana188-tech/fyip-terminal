import { getCurrentUser } from "@/lib/auth/current";
import { isPostgres } from "@/lib/db";
import { ensureSeeded } from "@/lib/db/seed";
import { aiStatus } from "@/lib/news/ai";
import { collectDueNewsSources, ensureNewsCollector, type CollectSummary } from "@/lib/news/ingest";
import { NEWS_DISCLAIMER, NEWS_METHODOLOGY, sseFrame } from "@/lib/news/pipeline";
import {
  getNewsSettings,
  listNewsSourceHealth,
  listNewsStories,
  newsCounts,
  storiesUpdatedSince,
} from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * FYP NEWS live stream.
 *
 * SSE is the primary realtime update path: new/merged/clustered stories are
 * polled from storage every 3s (works across serverless instances), while the
 * same connection also triggers due-source collection. Pausing the UI only
 * freezes the visual feed; ingestion continues because this endpoint stays
 * connected.
 */
export async function GET(req: Request): Promise<Response> {
  ensureSeeded();
  ensureNewsCollector();

  const user = getCurrentUser();
  if (!user || !user.permissions.includes("news.read")) {
    return new Response(
      JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Authentication required." } }),
      { status: 401, headers: { "content-type": "application/json", "cache-control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown, id?: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data, id)));
        } catch {
          closed = true;
        }
      };

      const openedAt = new Date().toISOString();
      let sinceReceived = new Date(Date.now() - 1_000).toISOString();
      let sinceUpdated = sinceReceived;

      send("hello", {
        serverTime: openedAt,
        mode: isPostgres() ? "request-triggered" : "interval+request",
        methodology: NEWS_METHODOLOGY,
        disclaimer: NEWS_DISCLAIMER,
        ai: aiStatus(),
        collectionEnabled: getNewsSettings().collectionEnabled,
      });

      try {
        const snapshot = listNewsStories({ limit: 30, sort: "newest" }, user.id);
        send("snapshot", {
          stories: snapshot.stories,
          total: snapshot.total,
          counts: newsCounts(user.id),
          sources: listNewsSourceHealth(),
          generatedAt: new Date().toISOString(),
        });
      } catch {
        send("error", { message: "Initial news snapshot could not be loaded." });
      }

      let collecting = false;
      const runCollection = () => {
        if (collecting) return;
        collecting = true;
        void collectDueNewsSources({
          maxSources: isPostgres() ? 2 : 4,
          budgetMs: isPostgres() ? 7_000 : 15_000,
          triggeredBy: "sse",
        })
          .then((summary: CollectSummary) => {
            send("collect", summary);
            send("health", {
              sources: listNewsSourceHealth(),
              counts: newsCounts(user.id),
              lastCollectionAt: summary.finishedAt,
            });
          })
          .catch(() => {
            send("error", { message: "News collection failed; the stream will retry." });
          })
          .finally(() => {
            collecting = false;
          });
      };

      const initialCollect = setTimeout(runCollection, 150);
      const collector = setInterval(runCollection, 30_000);

      const poller = setInterval(() => {
        try {
          const updates = storiesUpdatedSince(sinceReceived, sinceUpdated, user.id, 100);
          for (const story of updates) {
            send("story", { story });
            if (story.receivedAt > sinceReceived) sinceReceived = story.receivedAt;
            if (story.updatedAt > sinceUpdated) sinceUpdated = story.updatedAt;
          }
          if (updates.length > 0) {
            send("counts", newsCounts(user.id));
          }
        } catch {
          // Transient DB errors must not close an otherwise healthy stream.
        }
      }, 3_000);

      const health = setInterval(() => {
        send("health", {
          sources: listNewsSourceHealth(),
          counts: newsCounts(user.id),
        });
      }, 60_000);

      const ping = setInterval(() => send("ping", { t: Date.now() }), 15_000);

      const close = () => {
        closed = true;
        clearTimeout(initialCollect);
        clearInterval(collector);
        clearInterval(poller);
        clearInterval(health);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
