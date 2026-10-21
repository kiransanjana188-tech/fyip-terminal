/**
 * Bridge authentication token resolution.
 *
 * Local workstations set FYIP_BRIDGE_TOKEN. Netlify Function environment
 * variables can only be configured through the dashboard, so when running on
 * Netlify Database without an explicit token a fixed deployment token is used.
 * The Add-On configuration must use the same value.
 */
export const CLOUD_BRIDGE_TOKEN = "fwLMlsM1SAzTqQUSc2KZrCUfObWP4jxi";

export function bridgeToken(): string | null {
  const configured = process.env.FYIP_BRIDGE_TOKEN;
  if (configured) return configured;
  if (process.env.NETLIFY_DB_URL) return CLOUD_BRIDGE_TOKEN;
  return null;
}
