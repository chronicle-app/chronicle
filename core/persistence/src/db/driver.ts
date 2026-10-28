import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type { BlobStore } from '../blob/BlobStore.js';
import type * as schema from './schema.js';
import type * as opsSchema from './opsSchema.js';

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
 * must never depend on it. New-row ids come from SQLite `RETURNING` instead
 * (drizzle `.returning(...).get()`), which both bindings support.
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

/**
 * The drizzle database, generalized over the run-result type so it is not tied
 * to one driver. The database `./nodeSqlite.ts` builds (whose run result carries
 * the extra `lastInsertRowid`) is assignable to this — the run-result type only
 * appears covariantly.
 */
export type Db = BaseSQLiteDatabase<'sync', DriverRunResult, typeof schema>;

/** A drizzle transaction handle derived from {@link Db}. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The ops sidecar's drizzle database (see `opsSchema.ts`). */
export type OpsDb = BaseSQLiteDatabase<'sync', DriverRunResult, typeof opsSchema>;

/** A drizzle transaction handle derived from {@link OpsDb}. */
export type OpsTx = Parameters<Parameters<OpsDb['transaction']>[0]>[0];

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
