/**
 * Standalone CLI to apply pending FYIP Terminal migrations:
 *   npm run db:migrate
 *
 * Loads lib/db/migrations.ts directly (no bundler aliases) so it runs under
 * plain `node --experimental-strip-types`. The Next.js app applies the same
 * migrations automatically on first DB access — this CLI exists for
 * container/orchestration init jobs and manual verification.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "../lib/db/migrations.ts";

const configured = process.env.FYIP_DB_PATH ?? "./data/fyip.db";
const dbPath = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version INTEGER PRIMARY KEY,
     name    TEXT NOT NULL,
     applied_at TEXT NOT NULL
   );`,
);

const applied = new Set<number>(
  (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
    (r) => r.version,
  ),
);

let pending = 0;
for (const m of migrations) {
  if (applied.has(m.version)) continue;
  pending++;
  db.exec("BEGIN;");
  try {
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
      m.version,
      m.name,
      new Date().toISOString(),
    );
    db.exec("COMMIT;");
    console.log(`applied ${String(m.version).padStart(3, "0")}: ${m.name}`);
  } catch (err) {
    db.exec("ROLLBACK;");
    console.error(`migration ${m.version} (${m.name}) failed:`, err);
    process.exit(1);
  }
}

if (pending === 0) console.log("schema already up to date");
console.log(`db: ${dbPath}`);
db.close();
