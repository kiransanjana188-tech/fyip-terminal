import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { execute, newId, queryOne } from "@/lib/db";

export const SESSION_COOKIE = "fyip_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h

export interface SessionRecord {
  id: string;
  user_id: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

function secret(): string {
  const s = process.env.FYIP_SESSION_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FYIP_SESSION_SECRET must be set (>=16 chars) in production.");
    }
    return "dev-only-insecure-change-me-please-0000000000000000";
  }
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Token format: sessionId.signature */
function serialize(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

function parse(token: string | undefined): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}): string {
  const id = newId("sess");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  execute(
    `INSERT INTO sessions (id, user_id, issued_at, expires_at, revoked_at, user_agent, ip)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    id,
    userId,
    now.toISOString(),
    expires.toISOString(),
    meta.userAgent ?? null,
    meta.ip ?? null,
  );
  return serialize(id);
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
}

/** Validate a raw signed cookie value against the DB. Returns null if invalid/expired/revoked. */
export function resolveSessionToken(token: string | undefined): ResolvedSession | null {
  const id = parse(token);
  if (!id) return null;
  const row = queryOne<SessionRecord>("SELECT * FROM sessions WHERE id = ?", id);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { sessionId: row.id, userId: row.user_id };
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export function revokeSession(sessionId: string): void {
  execute("UPDATE sessions SET revoked_at = ? WHERE id = ?", new Date().toISOString(), sessionId);
}

/** Read + validate the session from the incoming request cookies (Node runtime). */
export function getSessionFromCookies(): ResolvedSession | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return resolveSessionToken(token);
}