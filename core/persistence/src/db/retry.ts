import type { Db, OpsDb, OpsTx, Tx } from './driver.js';

/**
 * SQLite's one-writer rule, handled in one place. Every process that opens a
 * store shares the file's single write lock; a writer that arrives while
 * another holds it waits out `busy_timeout` and then throws `SQLITE_BUSY`.
 * The helpers here are the retry discipline layered on top of that timeout:
 * recognize the busy family of errors, back off with full jitter, and try
 * again a bounded number of times before surfacing the error.
 *
 * Everything is synchronous on purpose: the fold runs inside a synchronous
 * `db.transaction(...)` on every runtime (see driver.ts), so the retry must
 * not introduce an `await`. The sleep blocks the calling thread — acceptable
 * for a CLI, and for a writer worker thread; a read-only HTTP thread never
 * takes the write lock and so never sleeps here.
 */

export interface BusyRetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number;
  /** Backoff base in ms; attempt n sleeps uniformly in [0, min(cap, base·2ⁿ)]. */
  baseMs?: number;
  /** Backoff ceiling in ms. */
  capMs?: number;
  /** Synchronous sleep (tests inject; defaults to {@link sleepSync}). */
  sleep?: (ms: number) => void;
  /** Uniform [0,1) source for the jitter (tests inject). */
  random?: () => number;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_MS = 50;
const DEFAULT_CAP_MS = 1000;

/**
 * Whether an error is SQLite telling us the lock is held: `SQLITE_BUSY` and
 * its extended codes (`_SNAPSHOT`, `_RECOVERY`, `_TIMEOUT`), or `SQLITE_LOCKED`.
 * better-sqlite3 sets `code`; the message check covers drivers that don't.
 */
export function isBusyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as { code?: unknown };
  if (
    typeof code === 'string' &&
    (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'))
  ) {
    return true;
  }
  const { message } = error as { message?: unknown };
  return typeof message === 'string' && /database (table )?is locked/i.test(message);
}

/**
 * Block the calling thread for `ms`. `Atomics.wait` on a throwaway shared
 * buffer is a true sleep (no CPU); where a runtime forbids it — a browser main
 * thread, or a JS engine without shared memory — a spin on the clock stands in.
 */
export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  if (
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof Atomics !== 'undefined' &&
    typeof Atomics.wait === 'function'
  ) {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
      return;
    } catch {
      // Not permitted on this thread — fall through to the spin.
    }
  }
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // spin
  }
}

/**
 * Run `fn`, retrying on a busy error with full-jitter exponential backoff.
 * Any other error is rethrown at once; a busy error on the last attempt is
 * rethrown as-is so the caller sees SQLite's own message.
 */
export function withBusyRetry<T>(fn: () => T, opts: BusyRetryOptions = {}): T {
  const attempts = Math.max(1, opts.attempts ?? DEFAULT_ATTEMPTS);
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS;
  const capMs = opts.capMs ?? DEFAULT_CAP_MS;
  const sleep = opts.sleep ?? sleepSync;
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (!isBusyError(error) || attempt + 1 >= attempts) throw error;
      const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
      sleep(Math.floor(random() * ceiling));
    }
  }
}

/**
 * The one way to open a write transaction on the store: `BEGIN IMMEDIATE`
 * (take the write lock up front, so a read-then-write inside can never fail
 * mid-transaction on an upgrade) wrapped in {@link withBusyRetry}. Every
 * writer in the persistence core goes through here.
 */
export function runImmediate<T>(db: Db, fn: (tx: Tx) => T, opts?: BusyRetryOptions): T;
export function runImmediate<T>(db: OpsDb, fn: (tx: OpsTx) => T, opts?: BusyRetryOptions): T;
export function runImmediate<T>(
  db: Db | OpsDb,
  fn: (tx: never) => T,
  opts: BusyRetryOptions = {}
): T {
  return withBusyRetry(
    () => (db as Db).transaction(fn as (tx: Tx) => T, { behavior: 'immediate' }),
    opts
  );
}
