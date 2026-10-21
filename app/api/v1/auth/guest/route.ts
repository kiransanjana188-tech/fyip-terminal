import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { fail, handler } from "@/lib/api/respond";
import { hashPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { execute, queryOne } from "@/lib/db";
import { recordAudit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUEST_EMAIL = "guest@fyip.local";

interface GuestRow {
  id: string;
  email: string;
  display_name: string;
  status: string;
}

function ensureGuestUser(): GuestRow {
  const existing = queryOne<GuestRow>("SELECT id, email, display_name, status FROM users WHERE email = ?", GUEST_EMAIL);
  if (existing) return existing;

  // The guest account has an unguessable random password and is logged in only
  // through this endpoint. Writes are blocked by RBAC (guest role = read-only).
  const id = `usr_guest`;
  const now = new Date().toISOString();
  execute(
    `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    id, GUEST_EMAIL, "Guest", hashPassword(randomBytes(32).toString("base64url")), now, now,
  );
  execute(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_guest')`, id);
  return queryOne<GuestRow>("SELECT id, email, display_name, status FROM users WHERE email = ?", GUEST_EMAIL)!;
}

export const POST = handler(async (req: Request) => {
  if (process.env.FYIP_DISABLE_GUEST === "true") {
    return fail(403, "GUEST_DISABLED", "Guest mode is disabled on this deployment.");
  }

  const user = ensureGuestUser();
  if (user.status !== "active") {
    return fail(403, "ACCOUNT_DISABLED", "Guest access is not active.");
  }

  const token = createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: requestIp(req) ?? undefined,
  });
  recordAudit({ actorId: user.id, actorEmail: GUEST_EMAIL, action: "auth.guest_login", status: "success", ip: requestIp(req) });

  const res = NextResponse.json({ id: user.id, email: user.email, displayName: user.display_name, roles: ["guest"] });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});
