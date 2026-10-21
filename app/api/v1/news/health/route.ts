import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { isPostgres } from "@/lib/db";
import { aiStatus } from "@/lib/news/ai";
import { NEWS_DISCLAIMER, NEWS_METHODOLOGY } from "@/lib/news/pipeline";
import {
  getNewsSettings,
  lastIngestRun,
  listNewsSourceHealth,
  newsCounts,
} from "@/lib/news/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = requirePermission("news.read");
  const settings = getNewsSettings();
  const sources = listNewsSourceHealth();
  return ok({
    generatedAt: new Date().toISOString(),
    counts: newsCounts(user.id),
    sources,
    enabledSources: sources.filter((source) => source.enabled).length,
    healthySources: sources.filter((source) => source.status === "ok").length,
    lastRun: lastIngestRun(),
    collection: {
      mode: isPostgres() ? "request-triggered" : "interval+request",
      collectionEnabled: settings.collectionEnabled,
      retentionDays: settings.retentionDays,
      note: isPostgres()
        ? "On Netlify, feeds are collected while the FYP NEWS page/stream is active or when a user triggers refresh. There is no always-on scheduler in this deployment, so coverage outside active sessions is not guaranteed."
        : "The workstation collector polls due sources every 60 seconds while the FYIP server is running.",
    },
    ai: aiStatus(),
    methodology: NEWS_METHODOLOGY,
    disclaimer: NEWS_DISCLAIMER,
  });
});
