import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { assertionSourceSql } from '../db/assertionSource.js';

// A NavigateAction is one step through an information space: `object` is where
// the step began, `target` where it ended — the same from/to pair a TravelAction
// uses for physical movement, on the slot that used to be `targetCollection`.
//
// The load-bearing property is that both ends land on the SAME url hubs the
// visits use, so a trail walks over the entities browsing already mints rather
// than a parallel set of its own.
const me = {
  '@type': 'Person',
  source: 'chrome',
  handle: 'me',
  '@key': ['@type', 'source', 'handle'],
};

const hub = (url: string) => ({ '@type': 'Entity', '@key': ['url'], url });

// The origin hub carries the link the click revealed as `references` — the same
// shape the extension emits (apps/extension/src/trail.ts). The NavigateAction is
// the event; the nested `references` is the structural fact "from links to to".
const step = (from: string, to: string, timestamp: string) => ({
  '@type': 'NavigateAction',
  '@key': ['@type', 'source', 'timestamp'],
  source: 'chrome',
  timestamp,
  // Pin the sighting time to the navigation instant. Without it every step is
  // sighted "now", and three ingests inside one millisecond collapse the
  // reference run's first/last anchors, flaking the span assertions.
  '@assertedAt': timestamp,
  agent: me,
  object: { ...hub(from), references: [hub(to)] },
  target: hub(to),
});

const visit = (url: string, timestamp: string) => ({
  '@type': 'ViewAction',
  '@key': ['@type', 'source', 'timestamp'],
  source: 'chrome',
  timestamp,
  agent: me,
  object: hub(url),
});

const A = 'https://a.example/post';
const B = 'https://b.example/paper';
const C = 'https://c.example/notes';

/** The (object → target) pairs, resolved to entity ids, newest last. */
const hops = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT cached_object_entity_id AS fromId, cached_target_entity_id AS toId
         FROM actions WHERE type = 'NavigateAction' ORDER BY occurred_at`
    )
    .all() as Array<{ fromId: number | null; toId: number | null }>;

/** The `references` runs: which entity references which, with run bookkeeping. */
const referenceRuns = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT p.cached_entity_id AS fromId, val.entity_id AS toId,
              subj.url AS fromUrl, val.url AS toUrl,
              p.cached_period_to AS periodTo,
              p.first_observed_valid_at AS firstValidAt,
              p.last_confirmed_valid_at AS lastValidAt
         FROM properties p
         JOIN sourced_entities subj ON subj.id = p.sourced_entity_id
         JOIN sourced_entities val ON val.id = p.value_sourced_id
        WHERE p.predicate = 'references'
        ORDER BY p.first_observed_observed_at`
    )
    .all() as Array<{
    fromId: number;
    toId: number;
    fromUrl: string;
    toUrl: string;
    periodTo: number | null;
    firstValidAt: number;
    lastValidAt: number;
  }>;

/** The hub each visit resolved to, in time order — what a step must land on. */
const visitedIds = (sqlite: SqliteDriver) =>
  (
    sqlite
      .prepare(
        `SELECT cached_object_entity_id AS id FROM actions
          WHERE type = 'ViewAction' ORDER BY occurred_at`
      )
      .all() as Array<{ id: number | null }>
  ).map(row => row.id);

describe('NavigateAction (a step through an information space)', () => {
  it('resolves object and target onto the same hubs the visits use', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        visit(A, '2026-07-19T10:00:00.000Z'),
        step(A, B, '2026-07-19T10:01:00.000Z'),
        visit(B, '2026-07-19T10:01:01.000Z'),
      ]);

      const [hop] = hops(sqlite);
      const [visitedA, visitedB] = visitedIds(sqlite);
      expect(hop.fromId).toBe(visitedA);
      expect(hop.toId).toBe(visitedB);
      // The step reuses the visits' hubs rather than minting a parallel pair.
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM entities`).get()).toMatchObject({
        n: 3, // the two pages + the self agent
      });
    } finally {
      close();
    }
  });

  it('chains into a trail that walks back to where it started', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        visit(A, '2026-07-19T10:00:00.000Z'),
        step(A, B, '2026-07-19T10:01:00.000Z'),
        step(B, C, '2026-07-19T10:05:00.000Z'),
        visit(C, '2026-07-19T10:05:01.000Z'),
      ]);

      const [first, second] = hops(sqlite);
      const [visitedA, visitedC] = visitedIds(sqlite);
      // B is the same entity on both hops — the join that makes a trail a walk.
      expect(first.toId).toBe(second.fromId);
      expect(first.fromId).toBe(visitedA);
      expect(second.toId).toBe(visitedC);
    } finally {
      close();
    }
  });

  it('keeps two steps out of one page as siblings, not a chain', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Two links opened from the same page: a branch, not a sequence.
      await processEvents(db, [
        step(A, B, '2026-07-19T10:01:00.000Z'),
        step(A, C, '2026-07-19T10:02:00.000Z'),
      ]);

      const [first, second] = hops(sqlite);
      expect(first.fromId).toBe(second.fromId);
      expect(first.toId).not.toBe(second.toId);
    } finally {
      close();
    }
  });
});

// The click revealed a fact about the PAGE, not just the event: A holds a link
// to B. It rides nested on the step's `object` as `references`, an observation on
// the origin hub — so a page's outbound links accumulate as a real edge, while
// the trail of individual steps stays the action stream beside it.
describe('NavigateAction reveals a reference (the page links to the next)', () => {
  it('lands the link as a references edge on the origin hub, onto the visit hubs', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        visit(A, '2026-07-19T10:00:00.000Z'),
        step(A, B, '2026-07-19T10:01:00.000Z'),
        visit(B, '2026-07-19T10:01:01.000Z'),
      ]);

      const [ref] = referenceRuns(sqlite);
      const [visitedA, visitedB] = visitedIds(sqlite);
      // The edge reuses the visits' hubs — no parallel entities for the link.
      expect(ref.fromId).toBe(visitedA);
      expect(ref.toId).toBe(visitedB);
      expect(ref.fromUrl).toBe(A);
      expect(ref.toUrl).toBe(B);
    } finally {
      close();
    }
  });

  it('confirms one edge across repeat navigations rather than restating it', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // The same link followed three times: three events, one discovered fact.
      await processEvents(db, [
        step(A, B, '2026-07-19T10:00:00.000Z'),
        step(A, B, '2026-07-19T11:00:00.000Z'),
        step(A, B, '2026-07-19T12:00:00.000Z'),
      ]);

      expect(
        sqlite.prepare(`SELECT COUNT(*) AS n FROM actions WHERE type = 'NavigateAction'`).get()
      ).toMatchObject({ n: 3 });
      // Three sightings in the journal…
      expect(
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM observations WHERE predicate = 'references'`)
          .get()
      ).toMatchObject({ n: 3 });
      // …fold to a single edge, whose run spans from the first sighting of the
      // link to the latest confirmation of it.
      const runs = referenceRuns(sqlite);
      expect(runs).toHaveLength(1);
      expect(runs[0].lastValidAt).toBeGreaterThan(runs[0].firstValidAt);
    } finally {
      close();
    }
  });

  it('keeps two links out of one page as two distinct references', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        step(A, B, '2026-07-19T10:01:00.000Z'),
        step(A, C, '2026-07-19T10:02:00.000Z'),
      ]);

      const runs = referenceRuns(sqlite);
      expect(runs.map(r => r.toUrl).sort()).toEqual([B, C]);
      expect(new Set(runs.map(r => r.fromId)).size).toBe(1); // both out of A
    } finally {
      close();
    }
  });

  it('never closes the edge — a click is evidence of a link, never of its removal', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [step(A, B, '2026-07-19T10:00:00.000Z')]);
      const [ref] = referenceRuns(sqlite);
      // Grow-only: no `@asserts` on the hub, so nothing can retract the link.
      expect(ref.periodTo).toBeNull();
    } finally {
      close();
    }
  });

  it('attributes the reference to the witness, on a product-neutral hub', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [step(A, B, '2026-07-19T10:00:00.000Z')]);
      // The observation carries chrome (the browser saw the link)… The witness's
      // source is read off the assertion's stored body; the log has no column.
      const asserted = sqlite
        .prepare(
          `SELECT DISTINCT ${assertionSourceSql('p.body')} AS source FROM observations o
             JOIN assertions a ON a.id = o.assertion_id
             JOIN assertion_payloads p ON p.cid = a.cid
            WHERE o.predicate = 'references'`
        )
        .all() as Array<{ source: string }>;
      expect(asserted).toEqual([{ source: 'chrome' }]);
      // …while the hub it hangs on stays in the url namespace, owned by no product.
      const [ref] = referenceRuns(sqlite);
      const subj = sqlite
        .prepare(`SELECT source FROM sourced_entities WHERE entity_id = ? AND url = ?`)
        .get(ref.fromId, A) as { source: string };
      expect(subj.source).toBe('url');
    } finally {
      close();
    }
  });
});
