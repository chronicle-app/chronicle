import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';
import { rebuildDerived } from './fold.js';

// A PublishAction routes its agent to the work's `publisher` edge, opening the
// run at the publication's occurrence. The occurrence is a min/max-wins
// register: as finer publication evidence arrives it narrows. The run boundary
// is derived THROUGH that anchor, so it must sharpen with the register — not
// stay frozen at the estimate as of first shred.
const house = {
  '@type': 'Organization',
  source: 'test',
  sourceId: 'house',
  '@key': ['source', 'sourceId'],
  name: 'A Publishing House',
};
const novel = {
  '@type': 'Book',
  source: 'test',
  sourceId: 'novel',
  '@key': ['source', 'sourceId'],
  name: 'A Novel',
};
const publication = (timestamp: string, withAgent = true) => ({
  '@type': 'PublishAction',
  source: 'test',
  sourceId: 'publish-novel', // shared key → one action; its occurrence register narrows
  '@key': ['source', 'sourceId'],
  object: novel,
  ...(withAgent ? { agent: house } : {}),
  timestamp,
  '@assertedAt': '2024-06-01T00:00:00Z', // sighted now; the publication is 1862
});

const publisherFrom = (sqlite: SqliteDriver): number | null =>
  (
    sqlite
      .prepare(`SELECT cached_period_from AS pf FROM properties WHERE predicate = 'publisher'`)
      .get() as { pf: number | null } | undefined
  )?.pf ?? null;

const YEAR = Date.UTC(1862, 0, 1); // "1862" → the whole year, lower bound Jan 1
const DAY = Date.UTC(1862, 2, 30); // "1862-03-30" → the day

describe('run boundary derives through the anchor occurrence register', () => {
  it('a coarse publication opens publisher at the year; a finer one sharpens it', async () => {
    // coarse-then-fine, finer event RE-STATES the agent (rewrites the edge)
    {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvent(db, publication('1862'));
        expect(publisherFrom(sqlite)).toBe(YEAR);
        await processEvent(db, publication('1862-03-30'));
        expect(publisherFrom(sqlite)).toBe(DAY); // boundary sharpened with the register
      } finally {
        close();
      }
    }
    // fine-then-coarse → identical converged boundary (coarse never widens it)
    {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvent(db, publication('1862-03-30'));
        await processEvent(db, publication('1862'));
        expect(publisherFrom(sqlite)).toBe(DAY);
      } finally {
        close();
      }
    }
  });

  it('sharpens even when the narrowing event omits the agent (invalidation edge)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, publication('1862'));
      expect(publisherFrom(sqlite)).toBe(YEAR);
      // A bare finer date, no agent: it narrows the register but writes no
      // publisher row, so only the anchor-invalidation edge can refresh the run.
      await processEvent(db, publication('1862-03-30', false));
      expect(publisherFrom(sqlite)).toBe(DAY);
    } finally {
      close();
    }
  });

  it('a full rebuild lands the same boundary as the incremental fold', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, publication('1862'));
      await processEvent(db, publication('1862-03-30'));
      const incremental = publisherFrom(sqlite);
      rebuildDerived(db);
      expect(publisherFrom(sqlite)).toBe(incremental);
      expect(incremental).toBe(DAY);
    } finally {
      close();
    }
  });
});
