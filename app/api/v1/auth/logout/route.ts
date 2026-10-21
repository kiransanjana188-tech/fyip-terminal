import { NextResponse } from "next/server";
import { handler } from "@/lib/api/respond";
import { getSessionFromCookies, revokeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async () => {
  const session = getSessionFromCookies();
  if (session) {
    revokeSession(session.sessionId);
    recordAudit({ actorId: session.userId, action: "auth.logout", status: "success" });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});