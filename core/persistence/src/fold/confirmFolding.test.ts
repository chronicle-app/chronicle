import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { rebuildDerived } from './fold.js';

const me = { '@type': 'Person', source: 'test', sourceId: 'me', '@key': ['source', 'sourceId'] };

// A ReadAction of a Book named `name`, witnessed at `assertedAt`. The occurrence
// (`timestamp`) is fixed, so two sightings of the same name differ only in their
// root @assertedAt → same claim CID, new sighting → the gate mints a confirm.
const crawl = (assertedAt: string, name = '1984', kind?: 'restated') => ({
  '@type': 'ReadAction',
  source: 'test',
  sourceId: 'r1',
  timestamp: '2019-01-01T00:00:00Z',
  '@assertedAt': assertedAt,
  ...(kind ? { '@kind': kind } : {}),
  '@key': ['source', 'sourceId'],
  agent: me,
  object: { '@type': 'Book', source: 'test', sourceId: 'b1', name, '@key': ['source', 'sourceId'] },
});

interface NameRun {
  firstObs: number;
  lastObs: number;
  lastValid: number;
  lastAction: number;
}
const nameRun = (sqlite: SqliteDriver): NameRun =>
  sqlite
    .prepare(
      `SELECT first_observed_observed_at AS firstObs,
              last_confirmed_observed_at AS lastObs,
              last_confirmed_valid_at    AS lastValid,
              last_confirmed_action_id   AS lastAction
         FROM properties p
         JOIN sourced_entities se ON se.id = p.sourced_entity_id
        WHERE p.predicate = 'name' AND se.type = 'Book'`
    )
    .get() as NameRun;

// A LikeAction of the same Book, witnessed at `assertedAt`: like `crawl`, two
// sightings differ only in their root @assertedAt → same claim CID → a confirm.
const likeCrawl = (assertedAt: string) => ({
  '@type': 'LikeAction',
  source: 'test',
  sourceId: 'l1',
  timestamp: '2019-01-01T00:00:00Z',
  '@assertedAt': assertedAt,
  '@key': ['source', 'sourceId'],
  agent: me,
  object: {
    '@type': 'Book',
    source: 'test',
    sourceId: 'b1',
    name: '1984',
    '@key': ['source', 'sourceId'],
  },
});

// The `liked` special (action-derived) run for that LikeAction: built straight
// from the actions table, it carries no observations, so a confirm reaches it
// only through the action its claim founds.
const likedRun = (sqlite: SqliteDriver): NameRun =>
  sqlite
    .prepare(
      `SELECT first_observed_observed_at AS firstObs,
              last_confirmed_observed_at AS lastObs,
              last_confirmed_valid_at    AS lastValid,
              last_confirmed_action_id   AS lastAction
         FROM properties
        WHERE predicate = 'liked'`
    )
    .get() as NameRun;

const kindCount = (sqlite: SqliteDriver, kind: string): number =>
  (sqlite.prepare('SELECT count(*) AS n FROM assertions WHERE kind = ?').get(kind) as { n: number })
    .n;

const O1 = Date.parse('2024-01-01T00:00:00.000Z');
const O2 = Date.parse('2024-02-01T00:00:00.000Z');

describe('confirm folding — last_confirmed extension', () => {
  it('an assert-sourced confirm advances observed_at but pins valid_at/action_id (decision A)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        crawl('2024-01-01T00:00:00.000Z'),
        crawl('2024-02-01T00:00:00.000Z'), // same claim, new sighting → confirm
      ]);
      expect(kindCount(sqlite, 'assert')).toBe(1);
      expect(kindCount(sqlite, 'confirm')).toBe(1);

      const run = nameRun(sqlite);
      expect(run.firstObs).toBe(O1); // earliest evidence unchanged
      expect(run.lastObs).toBe(O2); // recency advanced by the confirm
      expect(run.lastValid).toBe(O1); // placement pinned to the confirmed row
      expect(run.lastValid).toBeLessThan(run.lastObs); // observed_at != valid_at now
    } finally {
      close();
    }
  });

  it('matches a full rebuild (incremental confirm fold == rebuildDerived)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        crawl('2024-01-01T00:00:00.000Z'),
        crawl('2024-02-01T00:00:00.000Z'),
      ]);
      // Compare the anchor TIMES, not `lastAction` — action row-ids are local and
      // not stable across a rebuild (AUTOINCREMENT doesn't reset after the DELETE);
      // the content-level invariant is the times.
      const times = (r: NameRun) => ({
        firstObs: r.firstObs,
        lastObs: r.lastObs,
        lastValid: r.lastValid,
      });
      const incremental = times(nameRun(sqlite));
      rebuildDerived(db);
      expect(times(nameRun(sqlite))).toEqual(incremental);
    } finally {
      close();
    }
  });

  it('a confirm arriving BEFORE its claim converges (dangling confirm)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Fold the later sighting's confirm first by folding both in one batch —
      // the confirm's shred finds no rows yet; the assert's fold then picks it up.
      await processEvents(db, [
        crawl('2024-02-01T00:00:00.000Z'),
        crawl('2024-01-01T00:00:00.000Z'),
      ]);
      // Whichever arrived first is the assert; the other is its confirm.
      expect(kindCount(sqlite, 'confirm')).toBe(1);
      const run = nameRun(sqlite);
      expect(run.lastObs).toBe(O2); // recency is the later sighting regardless of order
    } finally {
      close();
    }
  });

  it('advances an action-derived special run too (liked), observed_at only', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        likeCrawl('2024-01-01T00:00:00.000Z'),
        likeCrawl('2024-02-01T00:00:00.000Z'), // same claim, new sighting → confirm
      ]);
      const before = likedRun(sqlite);
      expect(before.firstObs).toBe(O1); // first encounter unchanged
      expect(before.lastObs).toBe(O2); // recency advanced by the confirm
      expect(before.lastValid).toBeLessThan(before.lastObs); // valid axis pinned, not moved

      // Order-independence: a full rebuild reaches the special run through the same
      // action→claim path and lands the same anchor times.
      const times = (r: NameRun) => ({
        firstObs: r.firstObs,
        lastObs: r.lastObs,
        lastValid: r.lastValid,
      });
      const incremental = times(before);
      rebuildDerived(db);
      expect(times(likedRun(sqlite))).toEqual(incremental);
    } finally {
      close();
    }
  });

  it('a restated-sourced confirm is inert for recency (decision B — the origin re-import rule)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        crawl('2024-01-01T00:00:00.000Z', '1984', 'restated'),
        crawl('2024-02-01T00:00:00.000Z', '1984', 'restated'), // restated re-import → confirm
      ]);
      expect(kindCount(sqlite, 'restated')).toBe(1);
      expect(kindCount(sqlite, 'confirm')).toBe(1);

      const run = nameRun(sqlite);
      // The confirm exists in the log but its claim is restated, not assert, so it
      // never advances recency: the archive re-reading its own notes is not a
      // source confirming the world.
      expect(run.lastObs).toBe(O1);
    } finally {
      close();
    }
  });
});
