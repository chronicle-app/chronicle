import type { BlobStore } from '../blob/BlobStore.js';
import type { Sql } from './sql.js';

/**
 * Runtime-portable SQLite surface. The persistence core reaches SQLite only
 * through these interfaces — never through a concrete driver package — so the
 * same fold/query code runs on Node (`node:sqlite`) and on Hermes/Expo
 * (expo-sqlite's synchronous bindings). The one hard requirement is that the
 * whole surface is SYNCHRONOUS: the fold of one event runs inside
 * `db.transaction(tx => …)`, a synchronous callback, on every runtime.
 */

/**
 * Result of a mutating statement. `lastInsertRowid` is deliberately omitted —
 * better-sqlite3 exposes it but expo-sqlite's sync API does not, so the fold
 * must never depend on it. New-row ids come from SQLite `RETURNING` instead,
 * which both bindings support.
 */
export interface DriverRunResult {
  changes: number;
}

/** A prepared statement. Parameters are positional. */
export interface DriverStatement {
  all(...params: unknown[]): unknown[];
  /** Undefined when no row matches. */
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): DriverRunResult;
}

/**
 * Minimal synchronous SQLite handle. On Node, `./nodeSqlite.ts` gives
 * `node:sqlite` the better-sqlite3 surface, which satisfies this STRUCTURALLY;
 * `openDatabase` passes that handle. A future Expo handle implements the same shape.
 */
export interface SqliteDriver {
  prepare(sql: string): DriverStatement;
  exec(sql: string): void;
  pragma(pragma: string): unknown;
  close(): void;
}

/** How a transaction takes its locks: SQLite's `BEGIN DEFERRED | IMMEDIATE | EXCLUSIVE`. */
export type TransactionBehavior = 'deferred' | 'immediate' | 'exclusive';

/**
 * The store's query handle over a {@link SqliteDriver} (see `database.ts`). It
 * runs statements built with `sql`, rows coming back as objects keyed by
 * column name, and opens transactions; a transaction opened inside another is
 * a savepoint.
 */
export interface Db {
  /** Every row the statement returns. */
  all<T = unknown>(query: Sql): T[];
  /** The first row, or undefined when there is none. */
  get<T = unknown>(query: Sql): T | undefined;
  run(query: Sql): DriverRunResult;
  /** Run `fn` in a transaction: committed when it returns, rolled back when it throws. */
  transaction<T>(fn: (tx: Tx) => T, options?: { behavior?: TransactionBehavior }): T;
}

/** The handle inside a transaction: the same {@link Db}. */
export type Tx = Db;

/** The ops sidecar's handle (see `migrate.ts`'s `OPS_DDL`). */
export type OpsDb = Db;

/** The ops sidecar's handle inside a transaction. */
export type OpsTx = Db;

/**
 * An opened store: the graph (`db` / `sqlite`), the ops sidecar (`ops` /
 * `opsSqlite`), and the blob store. Two files, two connections — no
 * transaction spans both (see `open.ts`).
 */
export interface OpenResult {
  db: Db;
  sqlite: SqliteDriver;
  ops: OpsDb;
  opsSqlite: SqliteDriver;
  blobs: BlobStore;
  close: () => void;
}
