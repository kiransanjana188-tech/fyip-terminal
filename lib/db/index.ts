import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./migrations";

/**
 * Single SQLite connection for the process, cached on globalThis so Next.js
 * hot-reload does not open a new handle on every request.
 *
 * Development uses the built-in `node:sqlite` engine. For production the same
 * SQL surface is compatible with PostgreSQL/TimescaleDB via a thin adapter
 * (see docs/DATA_ARCHITECTURE.md); SQLite is used here so the workstations runs
 * with zero external services in any environment.
 */
declare global {
  // eslint-disable-next-line no-var
  var __fyipDb: DatabaseSync | undefined;
  // eslint-disable-next-line no-var
  var __fyipDbPath: string | undefined;
}

function resolveDbPath(): string {
  const configured = process.env.FYIP_DB_PATH ?? "./data/fyip.db";
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

function open(): DatabaseSync {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseSync): void {
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
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.exec("BEGIN;");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
}

export function getDb(): DatabaseSync {
  const dbPath = resolveDbPath();
  if (!globalThis.__fyipDb || globalThis.__fyipDbPath !== dbPath) {
    globalThis.__fyipDb = open();
    globalThis.__fyipDbPath = dbPath;
  }
  return globalThis.__fyipDb;
}

/** Run a query returning many rows, typed by the caller. */
export function queryAll<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/** Run a query returning a single row (or undefined). */
export function queryOne<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** Execute a write statement. */
export function execute(sql: string, ...params: (string | number | null)[]): void {
  getDb().prepare(sql).run(...params);
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}