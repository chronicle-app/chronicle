import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';

// Reproduces the Things rename case: a task's mutable `name` rides on a
// PlanAction whose `timestamp` is the FIXED creation date. Re-crawling after a
// rename re-emits the same action with the new name. Whether the name's history
// is faithful hinges entirely on the SIGHTING time (@assertedAt), which the fold
// reads ONLY from `@assertedAt` — never the occurrence `timestamp`:
//
//   - @assertedAt = read time (snapshot) → each sighting places at its crawl
//     → clean OLD → NEW supersession.
//   - no @assertedAt → ingest stamps each crawl implicit-now, so the two crawls
//     still place at their distinct sighting times (their ingest instants), not
//     back-dated onto the creation timestamp. This closed an old fallback
//     bug where the occurrence doubled as the sighting and collapsed the rename.
const me = {
  '@type': 'Person',
  source: 'things-todo',
  sourceId: 'me',
  '@key': ['@type', 'source', 'sourceId'],
};
const CREATION = '2026-03-17T11:49:15.140Z';
const crawl = (name: string, assertedAt?: string) => ({
  '@type': 'PlanAction',
  source: 'things-todo',
  sourceId: 't1',
  timestamp: CREATION, // fixed creation date — the back-dating trap
  ...(assertedAt ? { '@assertedAt': assertedAt } : {}),
  agent: me,
  object: {
    '@type': 'Task',
    source: 'things-todo',
    sourceId: 't1',
    name,
    '@key': ['@type', 'source', 'sourceId'],
  },
  '@key': ['@type', 'source', 'sourceId'],
});

const nameRuns = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT v.body AS value, p.cached_period_from AS from_, p.cached_period_to AS to_
         FROM properties p
         JOIN vals v ON v.id = p.value_id
         JOIN sourced_entities se ON se.id = p.sourced_entity_id
        WHERE p.predicate = 'name' AND se.type = 'Task'
        ORDER BY COALESCE(p.cached_period_from, 0), p.id`
    )
    .all() as { value: string; from_: number | null; to_: number | null }[];

const nameSightings = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(`SELECT DISTINCT valid_at AS v FROM observations WHERE predicate = 'name' ORDER BY v`)
    .all() as { v: number }[];

const READ1 = '2026-06-20T19:00:00.000Z';
const READ2 = '2026-06-20T19:05:00.000Z';

describe('snapshot rename — name placement (the Things case)', () => {
  it('snapshot @assertedAt: clean OLD → NEW supersession at read times', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [crawl('Old', READ1), crawl('New', READ2)]);

      // two distinct sightings, at the two crawl times — not collapsed
      expect(nameSightings(sqlite).map(r => r.v)).toEqual([Date.parse(READ1), Date.parse(READ2)]);

      const runs = nameRuns(sqlite);
      expect(runs.map(r => JSON.parse(r.value))).toEqual(['Old', 'New']);
      expect(runs[0].to_).toBe(Date.parse(READ2)); // Old closed when New was first seen
      expect(runs[1].to_).toBeNull(); // New is current
    } finally {
      close();
    }
  });

  it('without @assertedAt: implicit-now stamps each crawl, not the creation date (bug fixed)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Two crawls on different days, neither carrying @assertedAt. Each is a
      // separate ingest, stamped implicit-now — so the two names place at their
      // two crawl instants and supersede cleanly, never back-dated onto CREATION.
      const day1 = Date.parse('2026-06-20T19:00:00.000Z');
      const day2 = Date.parse('2026-06-21T19:00:00.000Z');
      await processEvents(db, [crawl('Old')], { ingestedAt: day1 });
      await processEvents(db, [crawl('New')], { ingestedAt: day2 });

      const sightings = nameSightings(sqlite).map(r => r.v);
      expect(sightings).toEqual([day1, day2]);
      expect(sightings).not.toContain(Date.parse(CREATION));

      const runs = nameRuns(sqlite);
      expect(runs.map(r => JSON.parse(r.value))).toEqual(['Old', 'New']);
      expect(runs[0].to_).toBe(day2); // Old closed when New was first seen
      expect(runs[1].to_).toBeNull(); // New is current
    } finally {
      close();
    }
  });
});
