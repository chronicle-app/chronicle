import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import type { SqliteDriver } from '../db/driver.js';
import { processEvents } from '../process.js';
import { makeTestDb } from '../testing/testDb.js';
import { lowerQuery } from './cql.js';
import { queryActionIds } from './evaluate.js';
import { queryActionIdsByIds } from './query.js';

const me = { '@type': 'Person', source: 'test', sourceId: 'me', '@key': ['source', 'sourceId'] };
const like = (ts: string, sourceId: string, obj: string) => ({
  source: 'test',
  '@assertedAt': ts,
  timestamp: ts,
  '@type': 'LikeAction',
  sourceId,
  '@key': ['@type', 'source', 'sourceId'],
  agent: me,
  object: {
    '@type': 'MusicRecording',
    source: 'test',
    sourceId: obj,
    name: obj,
    '@key': ['source', 'sourceId'],
  },
});

// Four likes across time, plus one read that must never leak into a LikeAction set.
const events = [
  like('2019-01-01T00:00:00Z', 'l1', 's1'),
  like('2019-06-01T00:00:00Z', 'l2', 's2'),
  like('2020-01-01T00:00:00Z', 'l3', 's3'),
  like('2021-01-01T00:00:00Z', 'l4', 's4'),
  {
    source: 'test',
    '@assertedAt': '2022-01-01T00:00:00Z',
    timestamp: '2022-01-01T00:00:00Z',
    '@type': 'ReadAction',
    sourceId: 'r1',
    '@key': ['@type', 'source', 'sourceId'],
    agent: me,
    object: {
      '@type': 'Book',
      source: 'test',
      sourceId: 'b1',
      name: 'Dune',
      '@key': ['source', 'sourceId'],
    },
  },
];

async function store() {
  const { db, sqlite, close } = makeTestDb();
  await processEvents(db, events);
  return { open: { db, sqlite }, close };
}

// A resolved member set, as a collection's rule resolves it: every LikeAction.
const likes = (sqlite: SqliteDriver) =>
  new Set(queryActionIds(sqlite, lowerQuery(parse('type:LikeAction')), { limit: 1000 }));

// Each action's type and timeline placement, in page order.
const rowsOf = (sqlite: SqliteDriver, ids: number[]) =>
  ids.map(id => {
    const row = sqlite
      .prepare('SELECT type, occurred_at AS at FROM actions WHERE id = ?')
      .get(id) as { type: string; at: number };
    return { type: row.type, timestamp: new Date(row.at).toISOString() };
  });

describe('queryActionIdsByIds', () => {
  it('pages a resolved member set newest-first with a keyset cursor', async () => {
    const { open, close } = await store();
    try {
      const members = likes(open.sqlite);
      expect(members.size).toBe(4);

      const p1 = queryActionIdsByIds(open, members, { limit: 2 });
      const r1 = rowsOf(open.sqlite, p1.ids);
      expect(r1.map(a => a.type)).toEqual(['LikeAction', 'LikeAction']);
      expect(p1.hasMore).toBe(true);
      expect(p1.nextCursor).toBeDefined();
      // Newest first: l4 (2021) then l3 (2020).
      expect(r1.map(a => a.timestamp)).toEqual([
        '2021-01-01T00:00:00.000Z',
        '2020-01-01T00:00:00.000Z',
      ]);

      const p2 = queryActionIdsByIds(open, members, { limit: 2, cursor: p1.nextCursor });
      expect(rowsOf(open.sqlite, p2.ids).map(a => a.timestamp)).toEqual([
        '2019-06-01T00:00:00.000Z',
        '2019-01-01T00:00:00.000Z',
      ]);
      expect(p2.hasMore).toBe(false);
      expect(p2.nextCursor).toBeUndefined();
    } finally {
      close();
    }
  });

  it('returns exactly the resolved members and nothing else', async () => {
    const { open, close } = await store();
    try {
      const members = likes(open.sqlite);
      const page = queryActionIdsByIds(open, members, { limit: 100 });
      const rows = rowsOf(open.sqlite, page.ids);
      expect(rows).toHaveLength(4);
      expect(rows.every(a => a.type === 'LikeAction')).toBe(true);
    } finally {
      close();
    }
  });

  it('an empty set yields an empty page', async () => {
    const { open, close } = await store();
    try {
      const page = queryActionIdsByIds(open, new Set<number>(), { limit: 10 });
      expect(page.ids).toEqual([]);
      expect(page.hasMore).toBe(false);
    } finally {
      close();
    }
  });

  it('rejects a malformed cursor', async () => {
    const { open, close } = await store();
    try {
      expect(() => queryActionIdsByIds(open, new Set([1]), { cursor: 'nope' })).toThrow();
    } finally {
      close();
    }
  });
});
