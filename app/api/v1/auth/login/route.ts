import { NextResponse } from "next/server";
import { fail, handler, requireString } from "@/lib/api/respond";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { queryOne } from "@/lib/db";
import { recordAudit, requestIp } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: string;
}

export const POST = handler(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail(400, "VALIDATION_ERROR", "JSON body required.");

  const email = requireString(body.email, "email", 320).toLowerCase();
  const password = requireString(body.password, "password", 200);

  const user = queryOne<UserRow>("SELECT * FROM users WHERE email = ?", email);
  // Constant-ish response for unknown email vs bad password.
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordAudit({ actorEmail: email, action: "auth.login", status: "failure", ip: requestIp(req) });
    return fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  if (user.status !== "active") {
    recordAudit({ actorId: user.id, actorEmail: email, action: "auth.login", status: "denied", ip: requestIp(req) });
    return fail(403, "ACCOUNT_DISABLED", "This account is not active.");
  }

  const token = createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: requestIp(req) ?? undefined,
  });
  recordAudit({ actorId: user.id, actorEmail: email, action: "auth.login", status: "success", ip: requestIp(req) });

  const res = NextResponse.json({ id: user.id, email: user.email, displayName: user.display_name });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return res;
});