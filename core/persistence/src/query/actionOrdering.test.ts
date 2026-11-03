import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import type { SqliteDriver } from '../db/driver.js';
import { queryActionPage } from './evaluate.js';

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const obj = (sourceId: string) => ({
  '@type': 'Book',
  source: 'test',
  sourceId,
  '@key': ['source', 'sourceId'],
});
const read = (sourceId: string, over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  sourceId,
  agent: me,
  object: obj(sourceId),
  '@key': ['source', 'sourceId'],
  ...over,
});

// Each action's timeline placement (`occurred_at`), in page order.
const placements = (sqlite: SqliteDriver, ids: number[]) =>
  ids.map(id =>
    new Date(
      (
        sqlite.prepare('SELECT occurred_at AS at FROM actions WHERE id = ?').get(id) as {
          at: number;
        }
      ).at
    ).toISOString()
  );

// Ordering is newest-first by `sortInstant = COALESCE(end_time, occurred_at)`;
// for these point reads (no end_time) that is the occurrence. The invariant
// under test: it is the occurrence, never the sighting/crawl time.
describe('action timeline ordering — by occurrence, not sighting', () => {
  it('orders a 2019 read (exported 2024) before a 2020 read', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        // occurred 2019 but only sighted (exported) in 2024
        read('old-read', { timestamp: '2019', '@assertedAt': '2024-07-01T00:00:00.000Z' }),
        // occurred and sighted 2020
        read('newer-read', { timestamp: '2020-06-01T00:00:00.000Z' }),
      ]);

      const page = queryActionPage(open.sqlite, [], {});
      const order = placements(open.sqlite, page.ids);

      // newest-first by OCCURRENCE: 2020 read, then the 2019 read — even though
      // the 2019 read was *sighted* later (2024). Sighting-ordering would invert.
      expect(order).toEqual(['2020-06-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z']);
    } finally {
      open.sqlite.close();
    }
  });

  it('paginates coherently on the occurrence cursor', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        read('a', { timestamp: '2018', '@assertedAt': '2024-01-01T00:00:00.000Z' }),
        read('b', { timestamp: '2019', '@assertedAt': '2024-01-01T00:00:00.000Z' }),
        read('c', { timestamp: '2020', '@assertedAt': '2024-01-01T00:00:00.000Z' }),
      ]);

      const first = queryActionPage(open.sqlite, [], { limit: 2 });
      expect(first.hasMore).toBe(true);
      const second = queryActionPage(open.sqlite, [], { limit: 2, cursor: first.nextCursor });

      const ts = (ids: number[]) => placements(open.sqlite, ids);
      // descending occurrence across the page boundary: 2020, 2019 | 2018
      expect(ts(first.ids)).toEqual(['2020-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z']);
      expect(ts(second.ids)).toEqual(['2018-01-01T00:00:00.000Z']);
    } finally {
      open.sqlite.close();
    }
  });
});
