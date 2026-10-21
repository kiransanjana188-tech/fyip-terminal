/**
 * Canonical data-quality status used everywhere in FYIP TERMINAL.
 * Never transform an old price into a freshly-timestamped "live" quote — the
 * status is derived from the *source* event time, not the time we rendered it.
 */
export type DataStatus =
  | "live"
  | "delayed"
  | "stale"
  | "disconnected"
  | "historical"
  | "simulated"
  | "unavailable";

export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  live: "LIVE",
  delayed: "DELAYED",
  stale: "STALE",
  disconnected: "DISCONNECTED",
  historical: "HISTORICAL",
  simulated: "SIMULATED",
  unavailable: "UNAVAILABLE",
};

export const DATA_STATUS_CLASS: Record<DataStatus, string> = {
  live: "text-up border-up/40 bg-up/10",
  delayed: "text-info border-info/40 bg-info/10",
  stale: "text-warn border-warn/40 bg-warn/10",
  disconnected: "text-down border-down/40 bg-down/10",
  historical: "text-ink-dim border-line-2 bg-panel-2",
  simulated: "text-violet border-violet/40 bg-violet/10",
  unavailable: "text-ink-faint border-line bg-panel-2",
};

export interface StatusInput {
  /** Status the adapter declares (e.g. a provider that is inherently delayed). */
  declared: DataStatus;
  /** ISO timestamp from the provider/origin of the data, if any. */
  eventTimestamp?: string | null;
  /** ISO timestamp the server received the data. */
  receivedTimestamp?: string | null;
  /** Seconds of silence before an otherwise-live feed is STALE. */
  staleSeconds: number;
  /** Seconds of silence before a feed is DISCONNECTED. */
  disconnectSeconds: number;
  /** Whether the upstream connection is currently established. */
  connected: boolean;
  now?: number;
}

/**
 * Derive the displayed status. Rules, in priority order:
 *  1. simulated / historical / unavailable / delayed are passthrough (intrinsic).
 *  2. not connected -> disconnected.
 *  3. source age > disconnectSeconds -> disconnected.
 *  4. source age > staleSeconds -> stale.
 *  5. otherwise live.
 */
export function deriveDataStatus(input: StatusInput): DataStatus {
  const intrinsic: DataStatus[] = ["simulated", "historical", "unavailable", "delayed"];
  if (intrinsic.includes(input.declared)) return input.declared;
  if (!input.connected) return "disconnected";

  const ts = input.eventTimestamp ?? input.receivedTimestamp;
  if (!ts) return "unavailable";
  const now = input.now ?? Date.now();
  const ageSec = (now - new Date(ts).getTime()) / 1000;
  if (!Number.isFinite(ageSec)) return "unavailable";
  if (ageSec > input.disconnectSeconds) return "disconnected";
  if (ageSec > input.staleSeconds) return "stale";
  return "live";
}

export function bridgeThresholds(): { staleSeconds: number; disconnectSeconds: number } {
  return {
    staleSeconds: Number(process.env.FYIP_BRIDGE_STALE_SECONDS ?? 8),
    disconnectSeconds: Number(process.env.FYIP_BRIDGE_DISCONNECT_SECONDS ?? 30),
  };
}