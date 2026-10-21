import { handler, ok } from "@/lib/api/respond";
import { getCurrentUser } from "@/lib/auth/current";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const user = getCurrentUser();
  return ok({ authenticated: !!user, user });
});