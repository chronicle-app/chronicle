import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

// A favorites list EXPORTED in 2024 that records liking a book back in 2019.
// The `liked` run must be placed at when the like OCCURRED (2019), read
// off the action's occurrence range — never the crawl/export time (2024), which
// is only the sighting axis.
const me = {
  '@type': 'Person',
  source: 'goodreads',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const dune = {
  '@type': 'Book',
  source: 'goodreads',
  name: 'Dune',
  url: 'https://www.goodreads.com/book/show/44767458',
  '@key': ['source', 'url'],
};
const liked = (over: Record<string, unknown>) => ({
  '@type': 'LikeAction',
  '@synthetic': true,
  source: 'goodreads',
  agent: me,
  object: dune,
  ...over,
});

const likedRun = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT cached_period_from AS from_, cached_period_to AS to_,
              first_observed_valid_at AS validAt, first_observed_observed_at AS observedAt
         FROM properties WHERE predicate = 'liked' LIMIT 1`
    )
    .get() as { from_: number | null; to_: number | null; validAt: number; observedAt: number };

describe('special run placement — occurrence vs sighting', () => {
  it('places the liked run at the time of the like, not the export/crawl time', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        liked({ timestamp: '2019', '@assertedAt': '2024-07-01T00:00:00.000Z' })
      );
      const run = likedRun(sqlite);
      // placement = when it happened (2019), not when it was sighted (2024)
      expect(run.from_).toBe(Date.UTC(2019, 0, 1));
      expect(run.validAt).toBe(Date.UTC(2019, 0, 1));
      // the sighting axis is preserved separately as the error bar
      expect(run.observedAt).toBe(Date.parse('2024-07-01T00:00:00.000Z'));
    } finally {
      close();
    }
  });

  it('opens with an unknown start (by then) when no occurrence time is known', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Only a crawl time, no semantic timestamp → a state observation: liked
      // BY 2024, not AT 2024. The run opens with an unknown start.
      await processEvent(db, liked({ '@assertedAt': '2024-07-01T00:00:00.000Z' }));
      const run = likedRun(sqlite);
      expect(run.from_).toBeNull(); // unknown start — never placed at the crawl
      // the sighting is preserved as the error bar / by-then upper bound
      expect(run.observedAt).toBe(Date.parse('2024-07-01T00:00:00.000Z'));
      // and the occurrence register reads as "by then": (earliest NULL, latest set)
      const occ = sqlite
        .prepare(
          `SELECT time_earliest AS lo, time_latest AS hi FROM actions WHERE type = 'LikeAction'`
        )
        .get() as { lo: number | null; hi: number | null };
      expect(occ.lo).toBeNull();
      expect(occ.hi).toBe(Date.parse('2024-07-01T00:00:00.000Z'));
    } finally {
      close();
    }
  });
});
