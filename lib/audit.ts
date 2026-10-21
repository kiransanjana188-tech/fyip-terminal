import { getDb } from "@/lib/db";

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  status: "success" | "failure" | "denied";
  detail?: unknown;
  ip?: string | null;
}

/** Append an immutable audit record. Privileged operations must call this. */
export function recordAudit(input: AuditInput): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_logs (at, actor_id, actor_email, action, target, status, detail, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        input.actorId ?? null,
        input.actorEmail ?? null,
        input.action,
        input.target ?? null,
        input.status,
        input.detail === undefined ? null : JSON.stringify(input.detail),
        input.ip ?? null,
      );
  } catch (err) {
    // Auditing must never crash the request path.
    console.error("[fyip:audit] failed to record", (err as Error).message);
  }
}

export function requestIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}