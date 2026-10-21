import type { DataStatus } from "./types";

export const STATUS_LABEL: Record<DataStatus, string> = {
  live: "LIVE",
  delayed: "DELAYED",
  stale: "STALE",
  disconnected: "DISCONNECTED",
  historical: "HISTORICAL",
  simulated: "SIMULATED",
  unavailable: "UNAVAILABLE",
};

export const STATUS_CLASS: Record<DataStatus, string> = {
  live: "text-up border-up/40 bg-up/10",
  delayed: "text-info border-info/40 bg-info/10",
  stale: "text-warn border-warn/40 bg-warn/10",
  disconnected: "text-down border-down/40 bg-down/10",
  historical: "text-ink-dim border-line-2 bg-panel-2",
  simulated: "text-violet border-violet/40 bg-violet/10",
  unavailable: "text-ink-faint border-line bg-panel-2",
};