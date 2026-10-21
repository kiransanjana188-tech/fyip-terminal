import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from "node:worker_threads";

/**
 * Synchronous PostgreSQL facade for the Netlify deployment.
 *
 * The application is written against a blocking SQLite-style API. Rather than
 * rewriting every call site, queries are executed on a dedicated worker thread
 * that owns the `@netlify/database` connection, while the calling thread blocks
 * on `Atomics.wait`. The worker posts results back through a MessageChannel and
 * wakes the caller with a futex notification.
 *
 * Only used when `NETLIFY_DB_URL` is present; workstations keep using the
 * embedded SQLite engine.
 */

export type DbParam = string | number | bigint | boolean | null | Uint8Array | undefined;

export interface PgPreparedStatement {
  all(...params: DbParam[]): unknown[];
  get(...params: DbParam[]): unknown;
  run(...params: DbParam[]): { changes: number; lastInsertRowid: number };
}

export interface PgDatabase {
  prepare(sql: string): PgPreparedStatement;
  exec(sql: string): void;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  rows?: unknown[];
  rowCount?: number;
  error?: string;
  type?: string;
  message?: string;
  driver?: string;
}

const INIT_TIMEOUT_MS = 15_000;
const QUERY_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 5_000;

/**
 * The worker source is a plain string so Next.js never tries to bundle it:
 * `@netlify/database` is resolved by Node at runtime inside the Netlify
 * function, where the package is present in `node_modules`.
 */
const WORKER_SOURCE = `
const { workerData } = require("node:worker_threads");

const state = new Int32Array(workerData.state);
const port = workerData.port;

function toPg(sql) {
  let out = "";
  let quote = null;
  let index = 0;
  let counter = 0;
  const length = sql.length;
  while (index < length) {
    const ch = sql[index];
    if (quote) {
      out += ch;
      if (quote === "'" && ch === "'" && sql[index + 1] === "'") {
        out += sql[index + 1];
        index += 2;
        continue;
      }
      if (ch === quote) quote = null;
      index += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      index += 1;
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\\n", index);
      if (end === -1) {
        out += sql.slice(index);
        break;
      }
      out += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (ch === "/" && sql[index + 1] === "*") {
      const end = sql.indexOf("*/", index + 2);
      const stop = end === -1 ? length : end + 2;
      out += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (ch === "?") {
      counter += 1;
      out += "$" + counter;
      index += 1;
      continue;
    }
    out += ch;
    index += 1;
  }
  if (/\\bINSERT\\s+OR\\s+IGNORE\\b/i.test(out)) {
    out = out.replace(/\\bINSERT\\s+OR\\s+IGNORE\\b/i, "INSERT");
    if (!/\\bON\\s+CONFLICT\\b/i.test(out)) {
      out = out.replace(/;\\s*$/, "") + " ON CONFLICT DO NOTHING";
    }
  }
  return out;
}

function loadPg() {
  const { createRequire } = require("node:module");
  const path = require("node:path");
  try {
    return require("pg");
  } catch (firstError) {
    const bases = [process.cwd()];
    if (process.argv[1]) {
      bases.push(path.dirname(process.argv[1]));
      bases.push(path.dirname(path.dirname(process.argv[1])));
    }
    if (process.env.LAMBDA_TASK_ROOT) bases.push(process.env.LAMBDA_TASK_ROOT);
    for (const base of bases) {
      try {
        const localRequire = createRequire(path.join(base, "__fyip_pg__.js"));
        return localRequire("pg");
      } catch {}
    }
    throw firstError;
  }
}

async function start() {
  try {
    const pg = loadPg();
    if (workerData.connectionString && !process.env.NETLIFY_DB_URL) {
      process.env.NETLIFY_DB_URL = workerData.connectionString;
    }
    pg.types.setTypeParser(20, function (value) {
      return value === null ? null : Number(value);
    });
    pg.types.setTypeParser(1700, function (value) {
      return value === null ? null : Number(value);
    });
    const connectionString = workerData.connectionString || process.env.NETLIFY_DB_URL;
    const pool = new pg.Pool({
      connectionString: connectionString,
      max: 4,
      ssl: /sslmode=/.test(connectionString) ? undefined : { rejectUnauthorized: false },
    });
    const probe = await pool.connect();
    try {
      await probe.query("SELECT 1");
    } finally {
      probe.release();
    }

    port.on("message", async function (request) {
      let response;
      try {
        const text = toPg(request.sql);
        const values = (request.params || []).map(function (value) {
          if (typeof value === "boolean") return value ? 1 : 0;
          return value === undefined ? null : value;
        });
        if (request.mode === "exec") {
          await pool.query(text);
          response = { id: request.id, ok: true, rows: [], rowCount: 0 };
        } else {
          const result = await pool.query({ text: text, values: values });
          response = {
            id: request.id,
            ok: true,
            rows: result.rows,
            rowCount: result.rowCount === null ? 0 : result.rowCount,
          };
        }
      } catch (error) {
        response = {
          id: request.id,
          ok: false,
          error: error && error.message ? error.message : String(error),
        };
      }
      port.postMessage(response);
      Atomics.store(state, 1, 1);
      Atomics.notify(state, 1);
    });

    port.postMessage({ id: 0, type: "ready", ok: true, driver: "pg" });
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const stack = error && error.stack ? String(error.stack).slice(0, 400) : "";
    port.postMessage({
      id: 0,
      type: "init-error",
      ok: false,
      message: stack && message.indexOf(stack) === -1 ? message + " | " + stack : message,
    });
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
  }
}

start();
`;

function sleepSignal() {
  return new Int32Array(new SharedArrayBuffer(4));
}

export class PgSyncDatabase implements PgDatabase {
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly signal: Int32Array;
  private readonly sleep: Int32Array;
  private nextId = 1;
  private dead = false;

  constructor(connectionString?: string) {
    const state = new SharedArrayBuffer(8);
    this.signal = new Int32Array(state);
    this.sleep = sleepSignal();
    const { port1, port2 } = new MessageChannel();

    try {
      this.worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          state,
          port: port2,
          connectionString: connectionString ?? process.env.NETLIFY_DB_URL ?? null,
        },
        transferList: [port2],
      });
    } catch (err) {
      port1.close();
      throw new Error(
        `Could not start the Postgres worker: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.worker.unref();
    this.port = port1;
    this.port.unref();

    const wait = Atomics.wait(this.signal, 0, 0, INIT_TIMEOUT_MS);
    if (wait === "timed-out") {
      this.terminate();
      throw new Error(
        "Postgres worker did not become ready. Check that NETLIFY_DB_URL is set and @netlify/database is available in the function bundle.",
      );
    }

    const init = this.takeMessage(0, INIT_TIMEOUT_MS) as WorkerResponse | undefined;
    if (!init) {
      this.terminate();
      throw new Error("Postgres worker started without sending an initialisation message.");
    }
    if (init.type === "init-error") {
      this.terminate();
      throw new Error(`Postgres connection failed: ${init.message ?? "unknown error"}`);
    }
    if (init.type !== "ready") {
      this.terminate();
      throw new Error("Postgres worker sent an unexpected initialisation response.");
    }
  }

  private takeMessage(expectedId: number, timeoutMs: number): WorkerResponse | undefined {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const received = receiveMessageOnPort(this.port);
      if (received) {
        const message = received.message as WorkerResponse;
        if (message.id === expectedId || message.type === "ready" || message.type === "init-error") {
          return message;
        }
      }
      if (Date.now() >= deadline) return undefined;
      Atomics.wait(this.sleep, 0, 0, 1);
    }
  }

  private call(request: {
    mode: "query" | "exec";
    sql: string;
    params: DbParam[];
    timeoutMs?: number;
  }): WorkerResponse {
    if (this.dead) throw new Error("Postgres worker is not available.");
    const id = this.nextId++;
    Atomics.store(this.signal, 1, 0);
    this.port.postMessage({ id, mode: request.mode, sql: request.sql, params: request.params });

    const timeout = request.timeoutMs ?? QUERY_TIMEOUT_MS;
    const wait = Atomics.wait(this.signal, 1, 0, timeout);
    if (wait === "timed-out") {
      this.dead = true;
      this.terminate();
      throw new Error(`Postgres query timed out after ${timeout}ms.`);
    }
    Atomics.store(this.signal, 1, 0);

    const message = this.takeMessage(id, RESPONSE_TIMEOUT_MS);
    if (!message) {
      this.dead = true;
      this.terminate();
      throw new Error("Postgres worker response was lost.");
    }
    if (!message.ok) throw new Error(message.error ?? "Postgres query failed.");
    return message;
  }

  prepare(sql: string): PgPreparedStatement {
    return {
      all: (...params: DbParam[]) => this.call({ mode: "query", sql, params }).rows ?? [],
      get: (...params: DbParam[]) => this.call({ mode: "query", sql, params }).rows?.[0],
      run: (...params: DbParam[]) => {
        const response = this.call({ mode: "query", sql, params });
        return { changes: response.rowCount ?? 0, lastInsertRowid: 0 };
      },
    };
  }

  exec(sql: string): void {
    this.call({ mode: "exec", sql, params: [] });
  }

  close(): void {
    this.terminate();
  }

  private terminate(): void {
    try {
      this.port.close();
    } catch {
      // already closed
    }
    try {
      void this.worker.terminate();
    } catch {
      // already terminated
    }
  }
}
