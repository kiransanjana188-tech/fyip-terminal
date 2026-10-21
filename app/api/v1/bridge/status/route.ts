import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll, queryOne } from "@/lib/db";
import { bridgeToken } from "@/lib/market/bridge-token";
import { quoteHub } from "@/lib/market/hub";
import { bridgeThresholds, deriveDataStatus } from "@/lib/market/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InstallationRow {
  id: string;
  label: string;
  platform: string;
  last_heartbeat: string | null;
  connection_state: string;
  capabilities: string | null;
  version: string | null;
}

export const GET = handler(async () => {
  requirePermission("market.read");
  const thresholds = bridgeThresholds();
  const feed = quoteHub.feedState("ninjatrader");
  const persisted = queryOne<{ last: string | null }>(
    "SELECT MAX(received_timestamp) AS last FROM quote_snapshots WHERE provider = ?",
    "ninjatrader",
  );
  const lastEventAt = feed.lastEventAt ?? persisted?.last ?? null;
  const persistedFresh = lastEventAt
    ? (Date.now() - new Date(lastEventAt).getTime()) / 1000 <= thresholds.disconnectSeconds
    : false;
  const status = deriveDataStatus({
    declared: "live",
    eventTimestamp: lastEventAt,
    receivedTimestamp: lastEventAt,
    connected: feed.connected || persistedFresh,
    ...thresholds,
  });
  const installations = queryAll<InstallationRow>(
    "SELECT id, label, platform, last_heartbeat, connection_state, capabilities, version FROM bridge_installations WHERE revoked_at IS NULL",
  );
  return ok({
    configured: !!bridgeToken(),
    feed: { ...feed, lastEventAt, status },
    thresholds,
    installations,
  });
});