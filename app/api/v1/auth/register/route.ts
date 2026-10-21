import { NextResponse } from "next/server";
import { fail, handler, requireString } from "@/lib/api/respond";
import { hashPassword, passwordPolicyIssue } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { execute, getDb, newId } from "@/lib/db";
import { recordAudit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");

  const email = requireString(body.email, "email", 320).toLowerCase();
  const displayName = requireString(body.displayName, "displayName", 120);
  const password = requireString(body.password, "password", 200);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail(400, "VALIDATION_ERROR", "A valid email is required.");
  }
  const policy = passwordPolicyIssue(password);
  if (policy) return fail(400, "WEAK_PASSWORD", policy);

  const existing = getDb().prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return fail(409, "EMAIL_IN_USE", "An account with that email already exists.");

  const id = newId("usr");
  const now = new Date().toISOString();
  execute(
    `INSERT INTO users (id, email, display_name, password_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    id, email, displayName, hashPassword(password), now, now,
  );
  execute("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_viewer')", id);

  // A default watchlist gives new users something to work with immediately.
  execute(
    `INSERT INTO watchlists (id, user_id, name, is_default, created_at, updated_at)
     VALUES (?, ?, 'Default', 1, ?, ?)`,
    newId("wl"), id, now, now,
  );

  const token = createSession(id, { userAgent: req.headers.get("user-agent") ?? undefined, ip: requestIp(req) ?? undefined });
  recordAudit({ actorId: id, actorEmail: email, action: "auth.register", status: "success", ip: requestIp(req) });

  const res = NextResponse.json({ id, email, displayName }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});