import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

// One action (same source + sourceId → same @key → one row); each event carries
// the read date at a different precision. The action's occurrence range is a
// min/max-wins register that narrows as finer evidence arrives.
const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const read = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent: me,
  '@key': ['source', 'sourceId'],
  sourceId: 'finished-dune', // shared → one action across all events
  ...over,
});

const range = (sqlite: SqliteDriver) =>
  sqlite.prepare('SELECT time_earliest AS lo, time_latest AS hi FROM actions LIMIT 1').get() as {
    lo: number | null;
    hi: number | null;
  };

const YEAR_1949 = { lo: Date.UTC(1949, 0, 1), hi: Date.UTC(1950, 0, 1) - 1 };
const DAY_1949_03_03 = { lo: Date.UTC(1949, 2, 3), hi: Date.UTC(1949, 2, 4) - 1 };

describe('action occurrence range (fuzzy dates)', () => {
  it('widens a year-only timestamp to the whole year', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, read({ timestamp: '1949' }));
      expect(range(sqlite)).toEqual(YEAR_1949);
    } finally {
      close();
    }
  });

  it('collapses a precise timestamp to a point', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, read({ timestamp: '1949-03-03T14:00:00.000Z' }));
      const r = range(sqlite);
      expect(r.lo).toBe(r.hi);
      expect(r.lo).toBe(Date.parse('1949-03-03T14:00:00.000Z'));
    } finally {
      close();
    }
  });

  it('narrows a year to a precise day, regardless of arrival order', async () => {
    // coarse-then-fine
    {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvent(db, read({ timestamp: '1949' }));
        await processEvent(db, read({ timestamp: '1949-03-03' }));
        expect(range(sqlite)).toEqual(DAY_1949_03_03);
        expect(sqlite.prepare('SELECT COUNT(*) AS n FROM actions').get() as { n: number }).toEqual({
          n: 1,
        });
      } finally {
        close();
      }
    }
    // fine-then-coarse → identical
    {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvent(db, read({ timestamp: '1949-03-03' }));
        await processEvent(db, read({ timestamp: '1949' }));
        expect(range(sqlite)).toEqual(DAY_1949_03_03);
      } finally {
        close();
      }
    }
  });

  it('surfaces a conflict as an inverted range (earliest > latest)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, read({ timestamp: '1949' }));
      await processEvent(db, read({ timestamp: '1950-03-03' })); // outside 1949
      const r = range(sqlite);
      expect(r.lo!).toBeGreaterThan(r.hi!); // inverted = surfaced conflict, not coerced
    } finally {
      close();
    }
  });
});
