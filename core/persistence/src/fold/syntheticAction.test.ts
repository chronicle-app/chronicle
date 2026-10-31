import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

// A favorites list that only says "liked Dune in 2019": no explicit "I liked
// it" event, just the fact. The fold materialises a synthetic, content-keyed
// LikeAction (agent = me, object = the book) carrying the fuzzy year.
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
  '@synthetic': true, // no source-native @key; key by (type + participants)
  source: 'goodreads',
  agent: me,
  object: dune,
  ...over,
});

const actions = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      'SELECT key, type, synthetic, time_earliest AS lo, time_latest AS hi FROM actions ORDER BY id'
    )
    .all() as { key: string; type: string; synthetic: number; lo: number; hi: number }[];

// "Books I liked" — the materialized answer the query layer reads.
const likedBooks = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT e.cached_name AS name, p.cached_period_from AS from_, p.cached_period_to AS to_
         FROM properties p JOIN entities e ON e.id = p.cached_entity_id
        WHERE p.predicate = 'liked'
        ORDER BY p.cached_period_from`
    )
    .all() as { name: string; from_: number | null; to_: number | null }[];

const YEAR_2019 = { lo: Date.UTC(2019, 0, 1), hi: Date.UTC(2020, 0, 1) - 1 };

describe('synthetic action — favorites list "liked" with year-only date', () => {
  it('mints one content-keyed synthetic LikeAction carrying the fuzzy year', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, liked({ timestamp: '2019' }));
      const a = actions(sqlite);
      expect(a).toHaveLength(1);
      expect(a[0].type).toBe('LikeAction');
      expect(a[0].synthetic).toBe(1);
      expect({ lo: a[0].lo, hi: a[0].hi }).toEqual(YEAR_2019);
    } finally {
      close();
    }
  });

  it('opens a queryable `liked` run on the book, placed in 2019', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, liked({ timestamp: '2019' }));
      const books = likedBooks(sqlite);
      expect(books).toHaveLength(1);
      expect(books[0].name).toBe('Dune');
      // open run (no UnlikeAction closes it); placed at the year's lower bound
      expect(books[0].to_).toBeNull();
      expect(books[0].from_).toBe(YEAR_2019.lo);
    } finally {
      close();
    }
  });

  it('re-importing the unchanged list is a no-op (one action, one run)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, liked({ timestamp: '2019' }));
      await processEvent(db, liked({ timestamp: '2019' }));
      expect(actions(sqlite)).toHaveLength(1);
      expect(likedBooks(sqlite)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('a later precise date sharpens the same action, no new row', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, liked({ timestamp: '2019' }));
      await processEvent(db, liked({ timestamp: '2019-03-03' }));
      const a = actions(sqlite);
      expect(a).toHaveLength(1); // same content key → one action
      expect({ lo: a[0].lo, hi: a[0].hi }).toEqual({
        lo: Date.UTC(2019, 2, 3),
        hi: Date.UTC(2019, 2, 4) - 1,
      });
    } finally {
      close();
    }
  });
});
