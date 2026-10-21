import { handler, ok } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/current";
import { queryAll } from "@/lib/db";
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
  const status = deriveDataStatus({
    declared: "live",
    eventTimestamp: feed.lastEventAt,
    receivedTimestamp: feed.lastEventAt,
    connected: feed.connected,
    ...thresholds,
  });
  const installations = queryAll<InstallationRow>(
    "SELECT id, label, platform, last_heartbeat, connection_state, capabilities, version FROM bridge_installations WHERE revoked_at IS NULL",
  );
  return ok({
    configured: !!process.env.FYIP_BRIDGE_TOKEN,
    feed: { ...feed, status },
    thresholds,
    installations,
  });
});