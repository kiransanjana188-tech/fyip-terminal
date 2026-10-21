/**
 * Optional mirror of local bridge payloads to a remote (Netlify) deployment.
 *
 * The NinjaTrader Add-On reads its endpoint from `fyip_bridge_options.json`
 * only when it connects. Until NinjaTrader reconnects, this forwarder lets a
 * running workstation keep the cloud terminal fed without changing the Add-On.
 * Disabled unless both env vars are set; never runs in Postgres mode.
 */
export function forwardBridgePayload(raw: string): void {
  const url = process.env.FYIP_CLOUD_INGEST_URL;
  const token = process.env.FYIP_CLOUD_BRIDGE_TOKEN;
  if (!url || !token) return;
  if (process.env.NETLIFY_DB_URL) return;
  void fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: raw,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    // The local feed must never depend on the cloud mirror.
  });
}
