/**
 * Test-only stub for Node's built-in `node:sqlite`.
 *
 * Default behaviour: unit tests exercise pure calculation/normalization logic
 * and must never open a database, so the constructor throws when unresolved.
 *
 * Opt-in DB slices: when `FYIP_TEST_ENABLE_DB=1` is set at import time (tests
 * do this via `vi.hoisted` so the env exists before module evaluation) this
 * stub re-exports the real driver so integration tests can point FYIP_DB_PATH
 * at a temp file.
 */
import { createRequire } from "node:module";

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SqliteModule {
  DatabaseSync: any;
  StatementSync: any;
}

function loadModule(): SqliteModule {
  if (process.env.FYIP_TEST_ENABLE_DB === "1") {
    const req = createRequire(import.meta.url);
    return req("node:sqlite") as SqliteModule;
  }
  return {
    DatabaseSync: class {
      constructor() {
        throw new Error("node:sqlite is stubbed in unit tests; set FYIP_TEST_ENABLE_DB=1 for DB integration slices.");
      }
    },
    StatementSync: class {},
  };
}

const mod = loadModule();
export const DatabaseSync = mod.DatabaseSync;
export const StatementSync = mod.StatementSync;
export default mod;
