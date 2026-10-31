import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

// A standing `liked` relation: opened by a LikeAction and closed by an
// UnlikeAction on the same (liker agent, liked object) chain.
const me = {
  '@type': 'Person',
  source: 'arena',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const them = {
  '@type': 'Agent',
  source: 'arena',
  sourceId: 'them',
  '@key': ['source', 'sourceId'],
};
const like = (over: Record<string, unknown>) => ({
  '@type': 'LikeAction',
  source: 'arena',
  agent: me,
  object: them,
  '@key': ['@type', 'source', 'agent', 'object'],
  ...over,
});
const unlike = (over: Record<string, unknown>) => ({
  '@type': 'UnlikeAction',
  source: 'arena',
  agent: me,
  object: them,
  '@key': ['@type', 'source', 'agent', 'object'],
  ...over,
});

const likedRun = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT cached_period_from AS from_, cached_period_to AS to_
         FROM properties WHERE predicate = 'liked' LIMIT 1`
    )
    .get() as { from_: number | null; to_: number | null } | undefined;

describe('liked — opened by LikeAction, closed by UnlikeAction', () => {
  it('opens an unbounded run on a LikeAction', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, like({ timestamp: '2020-01-01T00:00:00.000Z' }));
      const run = likedRun(sqlite);
      expect(run?.from_).toBe(Date.parse('2020-01-01T00:00:00.000Z'));
      expect(run?.to_).toBeNull(); // still liked
    } finally {
      close();
    }
  });

  it('closes the run at the UnlikeAction', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, like({ timestamp: '2020-01-01T00:00:00.000Z' }));
      await processEvent(db, unlike({ timestamp: '2021-06-01T00:00:00.000Z' }));
      const run = likedRun(sqlite);
      expect(run?.from_).toBe(Date.parse('2020-01-01T00:00:00.000Z'));
      expect(run?.to_).toBe(Date.parse('2021-06-01T00:00:00.000Z'));
    } finally {
      close();
    }
  });
});
