import type { SQLInputValue, StatementSync } from 'node:sqlite';

type Parameters =
  | SQLInputValue[]
  | [namedParameters: Record<string, SQLInputValue>, ...anonymousParameters: SQLInputValue[]];

/**
 * Run a statement and type its rows. `node:sqlite` returns
 * `Record<string, SQLOutputValue>`; `T` is the caller's description of the
 * selected columns and is not checked at runtime.
 */
export function allRows<T>(statement: StatementSync, ...params: Parameters): T[] {
  return (statement.all as (...args: Parameters) => unknown[])(...params) as T[];
}

/** Run a statement and type its first row, or `undefined` when there is none. */
export function getRow<T>(statement: StatementSync, ...params: Parameters): T | undefined {
  return (statement.get as (...args: Parameters) => unknown)(...params) as T | undefined;
}

/** Run a statement and iterate its rows one at a time, typed as `T`. */
export function iterateRows<T>(
  statement: StatementSync,
  ...params: Parameters
): Iterator<T> & Iterable<T> {
  return (statement.iterate as (...args: Parameters) => Iterator<T> & Iterable<T>)(...params);
}

const SQLITE_BUSY = 5;

/**
 * Whether an error is SQLITE_BUSY, which `node:sqlite` reports as
 * `{ code: 'ERR_SQLITE_ERROR', errcode: 5 }` when another connection holds a
 * lock (for example an app that keeps its database exclusively locked).
 * Extended result codes (primary code in the low byte), such as
 * SQLITE_BUSY_SNAPSHOT, also match.
 */
export function isSqliteBusy(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, errcode } = err as { code?: unknown; errcode?: unknown };
  return (
    code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' && errcode % 256 === SQLITE_BUSY
  );
}
