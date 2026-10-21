import { execute, newId, queryAll, queryOne } from "@/lib/db";
import { quoteHub } from "@/lib/market/hub";
import type { NormalizedQuote } from "@/lib/providers/types";

/**
 * Alert engine. Each alert has a trigger definition, state and deduplication
 * policy. An alert fires once when it crosses into a triggered state and does
 * NOT fire again (on every poll) while the condition remains true — it re-arms
 * only after the condition clears. This prevents sustained conditions from
 * generating an unbounded stream of notifications.
 */
export type AlertKind = "quote_threshold" | "pct_change" | "feed_down" | "news_keyword" | "economic_reminder";
export type AlertOp = "gt" | "lt" | "gte" | "lte";

export interface AlertCondition {
  field?: "last" | "bid" | "ask" | "volume";
  op: AlertOp;
  value: number;
  /** Optional percent-change threshold relative to prevClose. */
  pct?: boolean;
}

export interface AlertRow {
  id: string;
  user_id: string;
  name: string;
  kind: AlertKind;
  target: string | null;
  condition: string;
  delivery: string;
  enabled: number;
  state: string;
  last_fired_at: string | null;
}

export interface FiredAlert {
  alertId: string;
  name: string;
  message: string;
  firedAt: string;
  payload: Record<string, unknown>;
}

function compare(a: number, op: AlertOp, b: number): boolean {
  switch (op) {
    case "gt": return a > b;
    case "lt": return a < b;
    case "gte": return a >= b;
    case "lte": return a <= b;
  }
}

function quoteValue(q: NormalizedQuote, cond: AlertCondition): number | null {
  const field = cond.field ?? "last";
  if (field === "last") return q.last;
  if (field === "bid") return q.bid;
  if (field === "ask") return q.ask;
  if (field === "volume") return q.volume;
  return null;
}

/** Evaluate all enabled alerts for a user, firing any that newly cross. */
export function evaluateAlertsForUser(userId: string): FiredAlert[] {
  const alerts = queryAll<AlertRow>(
    "SELECT * FROM alerts WHERE user_id = ? AND enabled = 1",
    userId,
  );
  const fired: FiredAlert[] = [];
  for (const a of alerts) {
    if (a.kind !== "quote_threshold" && a.kind !== "pct_change") continue;
    if (!a.target) continue;
    const quote = quoteHub.get(a.target);
    if (!quote) continue;
    let cond: AlertCondition;
    try {
      cond = JSON.parse(a.condition) as AlertCondition;
    } catch {
      continue;
    }
    let value = quoteValue(quote, cond);
    if (value === null || value === undefined) continue;
    if (a.kind === "pct_change" || cond.pct) {
      if (!quote.prevClose) continue;
      value = ((value - quote.prevClose) / quote.prevClose) * 100;
    }
    const hit = compare(value, cond.op, cond.value);
    const isArmed = a.state === "idle" || a.state === "rearmed";
    if (hit && isArmed) {
      const at = new Date().toISOString();
      const message = `${a.name}: ${value.toFixed(4)} ${cond.op} ${cond.value}`;
      execute(
        "INSERT INTO alert_events (id, alert_id, fired_at, message, payload, source) VALUES (?, ?, ?, ?, ?, ?)",
        newId("ae"), a.id, at, message, JSON.stringify({ value, quoteStatus: quote.dataStatus }), quote.provider,
      );
      execute("UPDATE alerts SET state = 'triggered', last_fired_at = ? WHERE id = ?", at, a.id);
      fired.push({ alertId: a.id, name: a.name, message, firedAt: at, payload: { value } });
    } else if (!hit && a.state === "triggered") {
      execute("UPDATE alerts SET state = 'rearmed' WHERE id = ?", a.id);
    }
  }
  return fired;
}

export function recentAlertEvents(userId: string, limit = 50) {
  return queryAll<{ id: string; alert_id: string; fired_at: string; message: string; source: string | null }>(
    `SELECT ae.* FROM alert_events ae JOIN alerts a ON a.id = ae.alert_id
     WHERE a.user_id = ? ORDER BY ae.fired_at DESC LIMIT ?`,
    userId,
    limit,
  );
}

export function createAlert(input: {
  userId: string;
  name: string;
  kind: AlertKind;
  target: string | null;
  condition: AlertCondition;
  delivery?: string;
}): string {
  const id = newId("alert");
  const now = new Date().toISOString();
  execute(
    `INSERT INTO alerts (id, user_id, name, kind, target, condition, delivery, enabled, state, last_fired_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'idle', NULL, ?, ?)`,
    id, input.userId, input.name, input.kind, input.target, JSON.stringify(input.condition),
    input.delivery ?? "in_app", now, now,
  );
  return id;
}

export function listAlerts(userId: string): AlertRow[] {
  return queryAll<AlertRow>("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC", userId);
}

export function alertCount(userId: string): number {
  const row = queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM alerts WHERE user_id = ?", userId);
  return row?.c ?? 0;
}