import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { lowerQuery } from './cql.js';
import { sql } from '../db/sql.js';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryActionIds, queryActionPage } from './evaluate.js';

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  name: 'Andrew',
  '@key': ['source', 'sourceId'],
};
const orwell = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'orwell',
  name: 'George Orwell',
  '@key': ['source', 'sourceId'],
};
const book = {
  '@type': 'Book',
  source: 'test',
  sourceId: 'b1',
  name: '1984',
  author: [orwell],
  '@key': ['source', 'sourceId'],
};
const song = {
  '@type': 'MusicRecording',
  source: 'test',
  sourceId: 'song1',
  name: 'Imagine',
  '@key': ['source', 'sourceId'],
};
const action = (
  type: string,
  sourceId: string,
  timestamp: string,
  over: Record<string, unknown>
) => ({
  '@type': type,
  source: 'test',
  sourceId,
  timestamp,
  '@assertedAt': timestamp, // event-native: witnessed as it occurs
  agent: me,
  '@key': ['source', 'sourceId'],
  ...over,
});

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    action('ReadAction', 'r1', '2020-01-01T00:00:00Z', { object: book }),
    action('ListenAction', 'r2', '2021-01-01T00:00:00Z', { object: song }),
    action('AddAction', 'r3', '2022-01-01T00:00:00Z', {
      object: book,
      target: {
        '@type': 'Collection',
        source: 'test',
        sourceId: 'c1',
        name: 'Favourites',
        '@key': ['source', 'sourceId'],
      },
    }),
    action('MeasureAction', 'r4', '2023-01-01T00:00:00Z', {
      instrument: [
        {
          '@type': 'Entity',
          source: 'test',
          sourceId: 'scale',
          name: 'Scale',
          '@key': ['source', 'sourceId'],
        },
      ],
      result: {
        '@type': 'Entity',
        source: 'test',
        sourceId: 'res1',
        name: 'Reading',
        '@key': ['source', 'sourceId'],
      },
    }),
  ]);
  return open;
}

type Open = Awaited<ReturnType<typeof seeded>>;

const runCql = (open: Open, cql: string) => queryActionIds(open.sqlite, lowerQuery(parse(cql)));

describe('action queries', () => {
  it('matches action types with subclass expansion', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'type:ReadAction')).toHaveLength(1);
      // ConsumeAction covers ReadAction and ListenAction
      expect(runCql(open, 'type:ConsumeAction')).toHaveLength(2);
      expect(runCql(open, 'type:Action')).toHaveLength(4);
    } finally {
      open.close();
    }
  });

  it('constrains role slots with nested entity recursion', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'object:{ type:Book }')).toHaveLength(2); // read + add
      expect(runCql(open, 'object:{ author:{ name:"George Orwell" } }')).toHaveLength(2);
      expect(runCql(open, 'agent:{ name:"Andrew" }')).toHaveLength(4);
      expect(runCql(open, 'agent:{ name:"Nobody" }')).toHaveLength(0);
      expect(runCql(open, 'object:"Imagine"')).toHaveLength(1); // dual name match
    } finally {
      open.close();
    }
  });

  it('supports the result/instrument/target roles', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'instrument:*')).toHaveLength(1);
      expect(runCql(open, 'result:*')).toHaveLength(1);
      expect(runCql(open, 'target:*')).toHaveLength(1);
      expect(runCql(open, 'target:{ name:"Favourites" }')).toHaveLength(1);
      expect(runCql(open, 'instrument:{ type:Book }')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('filters on time fields', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'timestamp:<2021-06-01')).toHaveLength(2);
      expect(runCql(open, 'timestamp:>2021-06-01')).toHaveLength(2);
      expect(runCql(open, 'type:ReadAction timestamp:>2021-01-01')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('supports negation and OR groups', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, '-type:ReadAction')).toHaveLength(3);
      expect(runCql(open, 'type:ReadAction | type:ListenAction')).toHaveLength(2);
    } finally {
      open.close();
    }
  });

  it('orders newest first and paginates with a keyset cursor', async () => {
    const open = await seeded();
    try {
      const first = queryActionPage(open.sqlite, [], { limit: 3 });
      expect(first.ids).toHaveLength(3);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).toBeDefined();

      const rest = queryActionPage(open.sqlite, [], { limit: 3, cursor: first.nextCursor });
      expect(rest.ids).toHaveLength(1);
      expect(rest.hasMore).toBe(false);

      const all = [...first.ids, ...rest.ids];
      expect(new Set(all).size).toBe(4);

      // newest first by asserted_at
      const times = open.sqlite
        .prepare(
          `SELECT asserted_at AS t FROM actions WHERE id IN (${all.map(() => '?').join(',')})
           ORDER BY asserted_at DESC, id DESC`
        )
        .all(...all) as Array<{ t: number }>;
      const ordered = queryActionIds(open.sqlite, []);
      const orderedTimes = ordered.map(
        id =>
          (
            open.sqlite.prepare('SELECT asserted_at AS t FROM actions WHERE id = ?').get(id) as {
              t: number;
            }
          ).t
      );
      expect(orderedTimes).toEqual(times.map(r => r.t));
    } finally {
      open.close();
    }
  });
});

describe('action fold caches', () => {
  it('populates asserted_at and the new role slots', async () => {
    const open = await seeded();
    try {
      const row = open.db.get<{
        assertedAt: number;
        instrumentEntityId: number | null;
        resultEntityId: number | null;
      }>(sql`
        SELECT asserted_at AS assertedAt, cached_instrument_entity_id AS instrumentEntityId,
               cached_result_entity_id AS resultEntityId
        FROM actions WHERE type = 'MeasureAction'
      `);
      expect(row?.assertedAt).toBe(Date.parse('2023-01-01T00:00:00Z'));
      expect(row?.instrumentEntityId).not.toBeNull();
      expect(row?.resultEntityId).not.toBeNull();

      const add = open.db.get<{ targetEntityId: number | null }>(sql`
        SELECT cached_target_entity_id AS targetEntityId
        FROM actions WHERE type = 'AddAction'
      `);
      expect(add?.targetEntityId).not.toBeNull();
    } finally {
      open.close();
    }
  });
});
