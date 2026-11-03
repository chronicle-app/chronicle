import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';
import { rebuildDerived } from './fold.js';
import { serializeSchema } from '../serialize/schema.js';

// A favorites-list like: a LikeAction with no date. It is a STATE
// observation — "as of the crawl, this like exists, so a liking-act
// happened BY then" — not a timeless claim and not an event AT the crawl. It
// lands with an upper-bound-only occurrence and opens its run with an unknown
// start.
//
// Cross-Assertion tightening: a RE-CRAWL of the same dateless like
// lands as a `confirm` (same claim CID). `reconcileObservedAnchor` now lowers the
// action's observed anchor to the EARLIEST sighting across all re-crawls, so the
// "by then" upper bound, occurred_at, and the run's first/last are order-
// independent regardless of which sighting shredded first (see the re-crawl test
// below). Still deferred to the deeper confirm-gate work: the observation rows, the
// entity name, and founding_assertion_cid remain dated by whichever sighting the
// gate kept as the full-bodied assert — those body-derived outputs converge only
// once both bodies meet under sync-union, not on a lone out-of-order re-crawl.
const me = {
  '@type': 'Person',
  source: 'arena',
  sourceId: 'me',
  name: 'Me',
  '@key': ['source', 'sourceId'],
};
const them = {
  '@type': 'Agent',
  source: 'arena',
  sourceId: 'them',
  name: 'Them',
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

const likedRun = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT cached_period_from AS from_, cached_period_to AS to_,
              first_observed_valid_at AS validAt, first_observed_observed_at AS observedAt
         FROM properties WHERE predicate = 'liked' LIMIT 1`
    )
    .get() as { from_: number | null; to_: number | null; validAt: number; observedAt: number };

const register = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(`SELECT time_earliest AS lo, time_latest AS hi FROM actions WHERE type = 'LikeAction'`)
    .get() as { lo: number | null; hi: number | null };

const JUN = Date.parse('2024-06-01T00:00:00.000Z');

// Fold the same dateless like sighted at two stamps (the second lands as a
// `confirm`, same claim CID) and report the derived by-then run + register.
const foldReCrawl = async (first: string, second: string) => {
  const { db, sqlite, close } = makeTestDb();
  try {
    await processEvent(db, like({ '@assertedAt': first }));
    await processEvent(db, like({ '@assertedAt': second }));
    const row = sqlite
      .prepare(
        `SELECT cached_period_from AS from_, cached_period_to AS to_,
                first_observed_observed_at AS firstObserved,
                last_confirmed_observed_at AS lastConfirmed
           FROM properties WHERE predicate = 'liked' LIMIT 1`
      )
      .get() as {
      from_: number | null;
      to_: number | null;
      firstObserved: number;
      lastConfirmed: number;
    };
    return { row, reg: register(sqlite) };
  } finally {
    close();
  }
};

describe('state observations — by-then occurrences', () => {
  it('a dateless like opens with an unknown start, bounded by the sighting', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, like({ '@assertedAt': '2024-06-01T00:00:00.000Z' }));
      const run = likedRun(sqlite);
      expect(run.from_).toBeNull(); // unknown start — never placed AT the crawl
      expect(run.to_).toBeNull(); // still liked
      expect(run.observedAt).toBe(JUN); // the sighting is the error bar
      // the occurrence register reads "by then": (earliest NULL, latest = sighting)
      expect(register(sqlite)).toEqual({ lo: null, hi: JUN });
    } finally {
      close();
    }
  });

  it('a later dated like of the same act collapses the occurrence to the date', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // A dated like is a DIFFERENT claim (its body carries the timestamp), so
      // both are asserts sharing the keyset — the register intersects, order-free.
      await processEvent(db, like({ '@assertedAt': '2024-06-01T00:00:00.000Z' }));
      await processEvent(
        db,
        like({ timestamp: '2020-01-01T00:00:00.000Z', '@assertedAt': '2024-07-01T00:00:00.000Z' })
      );
      const START = Date.parse('2020-01-01T00:00:00.000Z');
      expect(register(sqlite)).toEqual({ lo: START, hi: START }); // a point now
      expect(likedRun(sqlite).from_).toBe(START); // a known start
    } finally {
      close();
    }
  });

  it('a full rebuild lands the same by-then run as the incremental fold', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, like({ '@assertedAt': '2024-06-01T00:00:00.000Z' }));
      const before = likedRun(sqlite);
      rebuildDerived(db);
      expect(likedRun(sqlite)).toEqual(before);
      expect(before.from_).toBeNull();
    } finally {
      close();
    }
  });

  it('tightens the by-then bound to the earliest sighting across re-crawls, in any order', async () => {
    const JAN = '2024-01-01T00:00:00.000Z';
    const MAR = '2024-03-01T00:00:00.000Z';
    // The same dateless like, sighted twice: the second is a `confirm` (same
    // claim CID). Fold in BOTH orders — the earliest sighting must anchor "by
    // then" and the run's first_observed, the latest must anchor recency, no
    // matter which sighting shredded first.
    const forward = await foldReCrawl(JAN, MAR);
    const reverse = await foldReCrawl(MAR, JAN);

    // Order-independent: the earliest sighting opens the run and caps "by then";
    // the latest sighting is the recency error bar.
    const expected = {
      row: {
        from_: null,
        to_: null,
        firstObserved: Date.parse(JAN),
        lastConfirmed: Date.parse(MAR),
      },
      reg: { lo: null, hi: Date.parse(JAN) },
    };
    expect(forward).toEqual(expected);
    expect(reverse).toEqual(expected);
  });

  it('serializes as unknown-start + firstObserved, never a point-in-time claim', async () => {
    const { db, close } = makeTestDb();
    try {
      await processEvent(db, like({ '@assertedAt': '2024-06-01T00:00:00.000Z' }));
      const fact = serializeSchema(db, { temporal: true })
        .flatMap(e => e.properties.liked ?? [])
        .find(Boolean)!;
      expect(fact).toBeDefined();
      expect(fact.periodFrom).toBeNull(); // no start claim
      expect(fact.periodTo).toBeNull(); // ongoing
      expect(fact.firstObserved).toMatch(/2024-06-01/); // the by-then upper bound
    } finally {
      close();
    }
  });
});
