import { handler, ok } from "@/lib/api/respond";
import { getDb, isPostgres } from "@/lib/db";
import { migrations } from "@/lib/db/migrations";
import { quoteHub } from "@/lib/market/hub";
import { bridgeThresholds, deriveDataStatus } from "@/lib/market/status";
import { providerSummaries } from "@/lib/providers/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const db = getDb();
  const applied = isPostgres()
    ? migrations.length
    : ((db.prepare("SELECT COUNT(*) AS c FROM schema_migrations").get() as { c: number }).c ?? 0);
  const feeds = quoteHub.allFeeds();
  const thresholds = bridgeThresholds();

  const feedHealth = Object.entries(feeds).map(([provider, state]) => ({
    provider,
    connected: state.connected,
    lastEventAt: state.lastEventAt,
    eventCount: state.eventCount,
    status: deriveDataStatus({
      declared: provider === "fixture" ? "simulated" : "live",
      eventTimestamp: state.lastEventAt,
      receivedTimestamp: state.lastEventAt,
      connected: state.connected,
      ...thresholds,
    }),
  }));

  return ok({
    app: "FYIP TERMINAL",
    version: "0.1.0",
    time: new Date().toISOString(),
    database: { ok: true, engine: isPostgres() ? "postgres" : "sqlite", migrations: applied },
    quotes: { tracked: quoteHub.all().length, subscribers: quoteHub.subscriberCount() },
    feeds: feedHealth,
    providers: providerSummaries().map((p) => ({ key: p.key, kind: p.kind, configured: p.configured })),
  });
});