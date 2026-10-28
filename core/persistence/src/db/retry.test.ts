import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './open.js';
import type { OpenResult } from './driver.js';
import { isBusyError, runImmediate, withBusyRetry } from './retry.js';

const busy = (code = 'SQLITE_BUSY'): Error =>
  Object.assign(new Error('database is locked'), { code });

describe('isBusyError', () => {
  it('recognizes the busy and locked code families and the bare message', () => {
    expect(isBusyError(busy())).toBe(true);
    expect(isBusyError(busy('SQLITE_BUSY_SNAPSHOT'))).toBe(true);
    expect(isBusyError(busy('SQLITE_LOCKED'))).toBe(true);
    expect(isBusyError(new Error('database is locked'))).toBe(true);
    expect(isBusyError(new Error('database table is locked'))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isBusyError(new Error('no such table: x'))).toBe(false);
    expect(isBusyError(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT' }))).toBe(false);
    expect(isBusyError(null)).toBe(false);
    expect(isBusyError('database is locked')).toBe(false);
  });
});

describe('withBusyRetry', () => {
  it('retries a busy error with jittered backoff and returns the eventual value', () => {
    const sleeps: number[] = [];
    let calls = 0;
    const value = withBusyRetry(
      () => {
        calls++;
        if (calls < 3) throw busy();
        return 'ok';
      },
      { attempts: 4, baseMs: 100, capMs: 1000, sleep: ms => sleeps.push(ms), random: () => 0.5 }
    );
    expect(value).toBe('ok');
    expect(calls).toBe(3);
    // Full jitter: attempt n sleeps random() × min(cap, base·2ⁿ).
    expect(sleeps).toEqual([50, 100]);
  });

  it('caps the backoff ceiling', () => {
    const sleeps: number[] = [];
    let calls = 0;
    withBusyRetry(
      () => {
        calls++;
        if (calls < 5) throw busy();
        return 1;
      },
      { attempts: 5, baseMs: 100, capMs: 250, sleep: ms => sleeps.push(ms), random: () => 1 }
    );
    expect(sleeps).toEqual([100, 200, 250, 250]);
  });

  it('gives up after the attempt budget with the original error', () => {
    let calls = 0;
    expect(() =>
      withBusyRetry(
        () => {
          calls++;
          throw busy();
        },
        { attempts: 3, sleep() {} }
      )
    ).toThrow(/database is locked/);
    expect(calls).toBe(3);
  });

  it('rethrows a non-busy error at once', () => {
    let calls = 0;
    expect(() =>
      withBusyRetry(
        () => {
          calls++;
          throw new Error('no such table: nope');
        },
        { sleep() {} }
      )
    ).toThrow(/no such table/);
    expect(calls).toBe(1);
  });
});

describe('runImmediate under real contention', () => {
  let dir: string;
  let holder: OpenResult;
  let writer: OpenResult;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'chr-retry-'));
    const path = join(dir, 'store.db');
    holder = openDatabase({ path, busyTimeoutMs: 10 });
    writer = openDatabase({ path, busyTimeoutMs: 10 });
  });

  afterEach(() => {
    holder.close();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('succeeds once the other connection releases the write lock', () => {
    holder.sqlite.exec('BEGIN IMMEDIATE');
    let sleeps = 0;
    const result = runImmediate(
      writer.db,
      tx => {
        tx.run(sql`INSERT INTO meta (key, value) VALUES ('k', 'v')`);
        return 'written';
      },
      {
        attempts: 4,
        // The first backoff is where the holder lets go — a stand-in for the
        // other process finishing its batch.
        sleep() {
          sleeps++;
          holder.sqlite.exec('COMMIT');
        },
      }
    );
    expect(result).toBe('written');
    expect(sleeps).toBe(1);
    const row = writer.sqlite.prepare("SELECT value FROM meta WHERE key = 'k'").get() as {
      value: string;
    };
    expect(row.value).toBe('v');
  });

  it("surfaces SQLite's own busy error when the lock never frees", () => {
    holder.sqlite.exec('BEGIN IMMEDIATE');
    let sleeps = 0;
    expect(() =>
      runImmediate(writer.db, tx => tx.run(sql`INSERT INTO meta (key, value) VALUES ('k', 'v')`), {
        attempts: 3,
        sleep: () => sleeps++,
      })
    ).toThrow(/database is locked/);
    expect(sleeps).toBe(2);
    holder.sqlite.exec('COMMIT');
  });
});
