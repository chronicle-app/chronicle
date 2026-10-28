import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open.js';
import type { OpenResult } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryActionPage } from './evaluate.js';

/**
 * Action paging is intersection-based. The server pages each action
 * exactly once, newest-first by `sortInstant = COALESCE(end_time, occurred_at)`
 * then id, with a `<sortInstant>|<id>` keyset cursor. The window is an interval
 * intersection: an action matches when `[occurred_at, sortInstant]` overlaps
 * `[from, to)` (`occurred_at < to AND COALESCE(end_time, occurred_at) >= from`),
 * so a span that straddles a window boundary is caught from the side it crosses.
 * The client (not the server) splits a durated action into start/end rows.
 */

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const book = (id: string) => ({
  '@type': 'Book',
  source: 'test',
  sourceId: id,
  '@key': ['source', 'sourceId'],
});
const action = (type: string, sourceId: string, over: Record<string, unknown>) => ({
  '@type': type,
  source: 'test',
  sourceId,
  agent: me,
  object: book(sourceId),
  '@key': ['source', 'sourceId'],
  ...over,
});

/** Map a page of action ids back to their source ids, in page order. */
function sourceIdsOf(open: OpenResult, ids: number[]): string[] {
  const stmt = open.sqlite.prepare('SELECT source_id AS s FROM actions WHERE id = ?');
  return ids.map(id => (stmt.get(id) as { s: string }).s);
}

/** The `sortInstant` (COALESCE(end_time, occurred_at)) of each id, in page order. */
function sortInstantsOf(open: OpenResult, ids: number[]): number[] {
  const stmt = open.sqlite.prepare(
    'SELECT COALESCE(end_time, occurred_at) AS s FROM actions WHERE id = ?'
  );
  return ids.map(id => (stmt.get(id) as { s: number }).s);
}

/**
 * A closed span [Jan 5 → Feb 20] with point actions around and inside its
 * interval. sortInstant order (newest first): Mar1, span(Feb20), Feb1, Jan10, Jan1.
 */
async function seeded(): Promise<OpenResult> {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    action('BookmarkAction', 'jan1', { timestamp: '2024-01-01T00:00:00Z' }),
    action('VisitAction', 'span', {
      timestamp: '2024-01-05T00:00:00Z',
      startTime: '2024-01-05T00:00:00Z',
      endTime: '2024-02-20T00:00:00Z',
    }),
    action('BookmarkAction', 'jan10', { timestamp: '2024-01-10T00:00:00Z' }),
    action('BookmarkAction', 'feb1', { timestamp: '2024-02-01T00:00:00Z' }),
    action('BookmarkAction', 'mar1', { timestamp: '2024-03-01T00:00:00Z' }),
  ]);
  return open;
}

describe('action intersection windowing', () => {
  it('a window straddling the span end includes the span', async () => {
    const open = await seeded();
    try {
      // [Feb 1, Mar 1): the span started Jan 5 (before the window) but ends Feb 20
      // (inside it) — the straddling-end case start-only windowing used to miss.
      const page = queryActionPage(open.sqlite, [], {
        from: Date.parse('2024-02-01T00:00:00Z'),
        to: Date.parse('2024-03-01T00:00:00Z'),
      });
      expect(sourceIdsOf(open, page.ids)).toContain('span');
      // feb1 (occurred at the window's lower edge) is in; jan10/jan1 are below it.
      expect(sourceIdsOf(open, page.ids).sort()).toEqual(['feb1', 'span']);
    } finally {
      open.close();
    }
  });

  it('a window fully inside the span interval includes the span', async () => {
    const open = await seeded();
    try {
      // [Jan 10, Feb 1): both edges of the span lie outside the window, yet its
      // interval covers the whole window — intersection still matches it.
      const page = queryActionPage(open.sqlite, [], {
        from: Date.parse('2024-01-10T00:00:00Z'),
        to: Date.parse('2024-02-01T00:00:00Z'),
      });
      expect(sourceIdsOf(open, page.ids)).toContain('span');
      // jan10 occurs at the lower edge (>= from) and starts before to → in.
      expect(sourceIdsOf(open, page.ids).sort()).toEqual(['jan10', 'span']);
    } finally {
      open.close();
    }
  });

  it('pages each action exactly once, sortInstant-desc, union = full set', async () => {
    const open = await seeded();
    try {
      const seen: number[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = queryActionPage(open.sqlite, [], { limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.ids);
        if (!page.hasMore || page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      // No action duplicated across pages.
      expect(new Set(seen).size).toBe(seen.length);
      // The union is every action.
      expect(seen).toHaveLength(5);
      // Ordered by sortInstant descending: mar1, span(Feb20), feb1, jan10, jan1.
      expect(sourceIdsOf(open, seen)).toEqual(['mar1', 'span', 'feb1', 'jan10', 'jan1']);
      const instants = sortInstantsOf(open, seen);
      for (let i = 1; i < instants.length; i++)
        expect(instants[i]).toBeLessThanOrEqual(instants[i - 1]);
    } finally {
      open.close();
    }
  });

  it('keyset cursor is stable across a page boundary bisecting same-instant ties', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      // Four points sharing one instant (a tie the id tie-break must order), plus
      // one newer and one older, so the tie is split by a page boundary.
      await processEvents(open.db, [
        action('BookmarkAction', 'newer', { timestamp: '2024-06-02T00:00:00Z' }),
        action('BookmarkAction', 'tie-a', { timestamp: '2024-06-01T00:00:00Z' }),
        action('BookmarkAction', 'tie-b', { timestamp: '2024-06-01T00:00:00Z' }),
        action('BookmarkAction', 'tie-c', { timestamp: '2024-06-01T00:00:00Z' }),
        action('BookmarkAction', 'tie-d', { timestamp: '2024-06-01T00:00:00Z' }),
        action('BookmarkAction', 'older', { timestamp: '2024-05-31T00:00:00Z' }),
      ]);
      const seen: number[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = queryActionPage(open.sqlite, [], { limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.ids);
        if (!page.hasMore || page.nextCursor === undefined) break;
        cursor = page.nextCursor;
      }
      // Every action delivered once, none skipped at the tie boundary.
      expect(new Set(seen).size).toBe(6);
      expect(sourceIdsOf(open, seen)[0]).toBe('newer');
      expect(sourceIdsOf(open, seen).at(-1)).toBe('older');
      // The four ties are contiguous and complete.
      expect(sourceIdsOf(open, seen).slice(1, 5).sort()).toEqual([
        'tie-a',
        'tie-b',
        'tie-c',
        'tie-d',
      ]);
    } finally {
      open.close();
    }
  });
});
