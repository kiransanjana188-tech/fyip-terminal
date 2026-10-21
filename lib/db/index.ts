import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./migrations";
import { PgSyncDatabase, type DbParam } from "./postgres-sync";

export type { DbParam } from "./postgres-sync";

/**
 * Storage facade for FYIP TERMINAL.
 *
 * Workstations use the embedded `node:sqlite` engine (`data/fyip.db`).
 * Netlify Functions have a read-only filesystem, so when `NETLIFY_DB_URL` is
 * present the same synchronous API is served by a Postgres worker thread
 * (`lib/db/postgres-sync.ts`) backed by Netlify Database.
 */
export interface DbStatement {
  all(...params: DbParam[]): unknown[];
  get(...params: DbParam[]): unknown;
  run(...params: DbParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

export interface FyipDatabase {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
}

declare global {
  // eslint-disable-next-line no-var
  var __fyipDb: FyipDatabase | undefined;
  // eslint-disable-next-line no-var
  var __fyipDbPath: string | undefined;
  // eslint-disable-next-line no-var
  var __fyipPg: PgSyncDatabase | undefined;
}

/** True when the process is configured to use Netlify Database (Postgres). */
export function isPostgres(): boolean {
  return Boolean(process.env.NETLIFY_DB_URL);
}

function resolveDbPath(): string {
  const configured = process.env.FYIP_DB_PATH ?? "./data/fyip.db";
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

function normalizeParams(params: DbParam[]): (string | number | bigint | null | Uint8Array)[] {
  return params.map((param) => {
    if (typeof param === "boolean") return param ? 1 : 0;
    if (param === undefined) return null;
    return param;
  });
}

class SqliteDatabase implements FyipDatabase {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  prepare(sql: string): DbStatement {
    const statement = this.db.prepare(sql);
    return {
      all: (...params: DbParam[]) => statement.all(...normalizeParams(params)),
      get: (...params: DbParam[]) => statement.get(...normalizeParams(params)),
      run: (...params: DbParam[]) => statement.run(...normalizeParams(params)),
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }
}

type NodeSqliteModule = typeof import("node:sqlite");

/**
 * `node:sqlite` is loaded lazily so the module can also run on older Node
 * runtimes (for example Netlify Functions in Postgres mode) where the builtin
 * does not exist.
 */
function loadNodeSqlite(): NodeSqliteModule {
  const builtin = (
    process as unknown as { getBuiltinModule?: (id: string) => unknown }
  ).getBuiltinModule;
  const sqlite = builtin?.("node:sqlite") as NodeSqliteModule | undefined;
  if (!sqlite) {
    throw new Error(
      "Embedded SQLite requires Node.js 22.5+ (process.getBuiltinModule). Use NETLIFY_DB_URL for Postgres.",
    );
  }
  return sqlite;
}

function open(): FyipDatabase {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const { DatabaseSync: Sqlite } = loadNodeSqlite();
  const db = new Sqlite(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return new SqliteDatabase(db);
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

export function getDb(): FyipDatabase {
  if (isPostgres()) {
    if (!globalThis.__fyipPg) {
      globalThis.__fyipPg = new PgSyncDatabase(process.env.NETLIFY_DB_URL);
    }
    return globalThis.__fyipPg;
  }

  const dbPath = resolveDbPath();
  if (!globalThis.__fyipDb || globalThis.__fyipDbPath !== dbPath) {
    globalThis.__fyipDb = open();
    globalThis.__fyipDbPath = dbPath;
  }
  return globalThis.__fyipDb;
}

/** Run a query returning many rows, typed by the caller. */
export function queryAll<T>(sql: string, ...params: DbParam[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

/** Run a query returning a single row (or undefined). */
export function queryOne<T>(sql: string, ...params: DbParam[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

/** Execute a write statement. */
export function execute(sql: string, ...params: DbParam[]): void {
  getDb().prepare(sql).run(...params);
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
