import { NextResponse } from "next/server";
import { getDb, isPostgres } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment diagnostics. Read-only and secret-free: reports which storage
 * engine is active, whether a probe query succeeds, and the error message when
 * it does not. Bypasses the normal API bootstrap so it still responds when
 * seeding is broken.
 */
export async function GET() {
  const started = Date.now();
  const engine = isPostgres() ? "postgres" : "sqlite";
  try {
    const db = getDb();
    const probe = db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    let tables: number | null = null;
    try {
      const row = db
        .prepare(
          isPostgres()
            ? "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = 'public'"
            : "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'",
        )
        .get() as { c: number } | undefined;
      tables = row?.c ?? null;
    } catch {
      tables = null;
    }
    return NextResponse.json(
      {
        engine,
        ok: probe?.ok === 1,
        tables,
        latencyMs: Date.now() - started,
        hasDatabaseUrl: Boolean(process.env.NETLIFY_DB_URL),
        node: process.version,
        region: process.env.AWS_REGION ?? null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        engine,
        ok: false,
        latencyMs: Date.now() - started,
        hasDatabaseUrl: Boolean(process.env.NETLIFY_DB_URL),
        node: process.version,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
