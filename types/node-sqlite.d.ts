/**
 * Minimal type declarations for Node's built-in `node:sqlite` module.
 * The bundled @types/node version predates these types; this shim covers the
 * subset of the API FYIP TERMINAL uses. Runtime support is provided by the
 * Node >= 22.5 built-in module.
 */
declare module "node:sqlite" {
  export type SQLInputValue =
    | string
    | number
    | bigint
    | null
    | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...params: SQLInputValue[]): unknown[];
    get(...params: SQLInputValue[]): unknown;
    run(...params: SQLInputValue[]): StatementResultingChanges;
    iterate(...params: SQLInputValue[]): IterableIterator<unknown>;
    setReadBigInts(enabled: boolean): void;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    open(options?: DatabaseSyncOptions): void;
  }
}