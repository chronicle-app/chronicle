import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';

// The isPartOf case: a task moved between projects. `isPartOf` is cardinality-
// MANY, so a new project does not evict the old — the departed membership closes
// only on a completeness marker. Two ways to mint one:
//   - `@asserts: ['*']` (the snapshot default) closes values still present in a
//     later snapshot but absent from this one — i.e. a CHANGED membership.
//   - `@asserts: ['isPartOf']` also closes it when the slot goes fully EMPTY.
const me = {
  '@type': 'Person',
  source: 'things-todo',
  sourceId: 'me',
  '@key': ['@type', 'source', 'sourceId'],
};
const project = (id: string, name: string) => ({
  '@type': 'Project',
  source: 'things-todo',
  sourceId: id,
  name,
  '@key': ['@type', 'source', 'sourceId'],
});
const crawl = (assertedAt: string, taskOver: Record<string, unknown>) => ({
  '@type': 'UpdateAction',
  source: 'things-todo',
  sourceId: 't1',
  timestamp: '2026-03-01T00:00:00.000Z',
  '@assertedAt': assertedAt,
  agent: me,
  object: {
    '@type': 'Task',
    source: 'things-todo',
    sourceId: 't1',
    name: 'My task',
    '@key': ['@type', 'source', 'sourceId'],
    ...taskOver,
  },
  '@key': ['@type', 'source', 'sourceId'],
});

const isPartOfRuns = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT vse_e.cached_name AS project, p.cached_period_to AS to_
         FROM properties p
         JOIN sourced_entities subj ON subj.id = p.sourced_entity_id
         LEFT JOIN sourced_entities vse ON vse.id = p.value_sourced_id
         LEFT JOIN entities vse_e ON vse_e.id = vse.entity_id
        WHERE subj.type = 'Task' AND p.predicate = 'isPartOf'
        ORDER BY vse_e.cached_name`
    )
    .all() as { project: string; to_: number | null }[];

const T1 = '2026-06-21T00:00:00.000Z';
const T2 = '2026-06-21T00:05:00.000Z';

describe('snapshot completeness — closing departed cardinality-many values', () => {
  it("`'*'` closes a project the task moved away from", async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        crawl(T1, { isPartOf: [project('p-a', 'Zev in SK')], '@asserts': ['*'] }),
        crawl(T2, { isPartOf: [project('p-b', '5yo Zev')], '@asserts': ['*'] }),
      ]);
      const runs = isPartOfRuns(sqlite);
      const byName = Object.fromEntries(runs.map(r => [r.project, r.to_]));
      expect(byName['5yo Zev']).toBeNull(); // current — open
      expect(byName['Zev in SK']).toBe(Date.parse(T2)); // closed when it vanished
    } finally {
      close();
    }
  });

  it('explicit `isPartOf` closes it even when the task leaves all projects', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        crawl(T1, { isPartOf: [project('p-a', 'Zev in SK')], '@asserts': ['isPartOf'] }),
        crawl(T2, { '@asserts': ['isPartOf'] }), // no isPartOf — moved out of all projects
      ]);
      const runs = isPartOfRuns(sqlite);
      expect(runs).toHaveLength(1);
      expect(runs[0].project).toBe('Zev in SK');
      expect(runs[0].to_).toBe(Date.parse(T2)); // closed — no longer part of anything
    } finally {
      close();
    }
  });

  it('a value first seen after an excluding marker gets a known (inferred) start', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Two batches so the second is maintained by the in-order FAST path (the
      // chain is already non-empty) — the path that materializes B's first run.
      await processEvents(db, [crawl(T1, { isPartOf: [project('p-a', 'A')], '@asserts': ['*'] })]);
      await processEvents(db, [crawl(T2, { isPartOf: [project('p-b', 'B')], '@asserts': ['*'] })]);

      const rows = sqlite
        .prepare(
          `SELECT vse_e.cached_name AS project, p.cached_period_from AS from_
             FROM properties p
             JOIN sourced_entities subj ON subj.id = p.sourced_entity_id
             LEFT JOIN sourced_entities vse ON vse.id = p.value_sourced_id
             LEFT JOIN entities vse_e ON vse_e.id = vse.entity_id
            WHERE subj.type = 'Task' AND p.predicate = 'isPartOf'`
        )
        .all() as { project: string; from_: number | null }[];
      const from = Object.fromEntries(rows.map(r => [r.project, r.from_]));

      // A: the very first value, at the first crawl — no prior marker, so its
      // start is genuinely unknown.
      expect(from.A).toBeNull();
      // B: first seen at T2, but T1's completeness marker excluded it — so we
      // know it began after T1: an inferred start at its first sighting.
      expect(from.B).toBe(Date.parse(T2));
    } finally {
      close();
    }
  });

  it('without any completeness manifest, both memberships stay open (the bug)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        crawl(T1, { isPartOf: [project('p-a', 'Zev in SK')] }),
        crawl(T2, { isPartOf: [project('p-b', '5yo Zev')] }),
      ]);
      const runs = isPartOfRuns(sqlite);
      expect(runs.every(r => r.to_ === null)).toBe(true); // both open — the reported bug
      expect(runs).toHaveLength(2);
    } finally {
      close();
    }
  });
});

// A completeness claim can only ever speak for its own source. Two sources that
// bookmark the same url both say "these are all the tags" — if they share one
// subject, each closes the other's tags and the next crawl closes them back, an
// invented history of tags churning. Source-scoping the key is what prevents it,
// and the merge still happens through the auto `{url}` hub.
const tagRuns = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT subj.source AS subjSource, vse.handle AS tag, p.cached_period_to AS to_
         FROM properties p
         JOIN sourced_entities subj ON subj.id = p.sourced_entity_id
         LEFT JOIN sourced_entities vse ON vse.id = p.value_sourced_id
        WHERE p.predicate = 'about'
        ORDER BY vse.handle`
    )
    .all() as { subjSource: string | null; tag: string; to_: number | null }[];

const tag = (source: string, handle: string) => ({
  '@type': 'Tag',
  source,
  handle,
  '@key': ['@type', 'source', 'handle'],
});

const bookmark = (
  source: string,
  assertedAt: string,
  tags: string[],
  key: string[]
): Record<string, unknown> => ({
  '@type': 'BookmarkAction',
  source,
  timestamp: assertedAt,
  '@assertedAt': assertedAt,
  '@key': ['@type', 'source', 'timestamp'],
  agent: { '@type': 'Person', source, handle: 'me', '@key': ['@type', 'source', 'handle'] },
  object: {
    '@type': 'Entity',
    source,
    url: 'https://example.com/post/42',
    about: tags.map(t => tag(source, t)),
    '@asserts': ['about'],
    '@key': key,
  },
});

const entityCount = (sqlite: SqliteDriver) =>
  (sqlite.prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number }).n;

describe('completeness is scoped to its source', () => {
  it('source-scoped subjects keep their own tags; both stay open, and they still merge', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        bookmark('pinboard', T1, ['watersheds'], ['url', 'source']),
        bookmark('chrome', T2, ['rivers'], ['url', 'source']),
      ]);
      const runs = tagRuns(sqlite);
      // Neither source's `@asserts: ['about']` closed the other's tag.
      expect(runs.map(r => [r.tag, r.to_])).toEqual([
        ['rivers', null],
        ['watersheds', null],
      ]);
      // ...and each ran on its own subject.
      expect(new Set(runs.map(r => r.subjSource))).toEqual(new Set(['chrome', 'pinboard']));
      // The bare `{url}` hub still merged the two bookmarks onto one entity:
      // the two sourced rows + the sourceless hub + two Tags + two agents.
      const pageEntities = sqlite
        .prepare(
          `SELECT COUNT(DISTINCT entity_id) AS n FROM sourced_entities
            WHERE json_extract(keyset, '$.url') IS NOT NULL`
        )
        .get() as { n: number };
      expect(pageEntities.n).toBe(1);
    } finally {
      close();
    }
  });

  it('a shared bare `{url}` subject lets one source close the other’s tags (the bug)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        bookmark('pinboard', T1, ['watersheds'], ['url']),
        bookmark('chrome', T2, ['rivers'], ['url']),
      ]);
      const runs = tagRuns(sqlite);
      const byTag = Object.fromEntries(runs.map(r => [r.tag, r.to_]));
      expect(byTag.rivers).toBeNull();
      // Pinboard never untagged anything — chrome's completeness claim closed it.
      expect(byTag.watersheds).toBe(Date.parse(T2));
    } finally {
      close();
    }
  });

  it('source-scoping costs no entities — the hub merges what the keys separate', async () => {
    const scoped = makeTestDb();
    const shared = makeTestDb();
    try {
      await processEvents(scoped.db, [
        bookmark('pinboard', T1, ['watersheds'], ['url', 'source']),
        bookmark('chrome', T2, ['watersheds'], ['url', 'source']),
      ]);
      await processEvents(shared.db, [
        bookmark('pinboard', T1, ['watersheds'], ['url']),
        bookmark('chrome', T2, ['watersheds'], ['url']),
      ]);
      // Same number of harmonized entities either way: scoping splits the sourced
      // rows, not the entity. (Tags stay per-source vocabularies in both.)
      expect(entityCount(scoped.sqlite)).toBe(entityCount(shared.sqlite));
    } finally {
      scoped.close();
      shared.close();
    }
  });
});
