/**
 * The satellite predicates: `id:` selects by content
 * identity through any member key of a merged cluster; `attachment:`
 * filters by stored bytes, optionally narrowed by mime class; and unknown
 * fields fail loudly with suggestions instead of matching nothing.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { openDatabase } from '../db/open.js';
import { MemoryBlobStore } from '../blob/MemoryBlobStore.js';
import { processEvents } from '../process.js';
import { lowerQuery, queryPage } from './cql.js';

const KEY = { '@key': ['source', 'sourceId'] };
const me = { '@type': 'Person', source: 't', sourceId: 'me', name: 'Me', sameAs: ['@me'], ...KEY };

const png = `data:image/png;base64,${Buffer.from('tiny test image bytes').toString('base64')}`;

const photo = {
  '@type': 'ImageObject',
  source: 't',
  sourceId: 'p1',
  name: 'Pic',
  contentData: png,
  ...KEY,
};
const note = { '@type': 'Post', source: 't', sourceId: 'n1', name: 'Note', ...KEY };

const EVENTS = [
  {
    '@type': 'CreateAction',
    source: 't',
    sourceId: 'c1',
    timestamp: '2024-01-01T00:00:00Z',
    '@assertedAt': '2024-01-01T00:00:00Z',
    agent: me,
    result: photo,
    ...KEY,
  },
  {
    '@type': 'CreateAction',
    source: 't',
    sourceId: 'c2',
    timestamp: '2024-01-02T00:00:00Z',
    '@assertedAt': '2024-01-02T00:00:00Z',
    agent: me,
    result: note,
    ...KEY,
  },
];

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, EVENTS, { blobs: new MemoryBlobStore() });
  return open;
}

function names(open: ReturnType<typeof openDatabase>, cql: string): string[] {
  const out = queryPage(open.sqlite, parse(cql), { limit: 50 });
  const column = out.target === 'actions' ? 'source_id FROM actions' : 'cached_name FROM entities';
  return out.ids
    .map(
      id =>
        Object.values(
          open.sqlite.prepare(`SELECT ${column} WHERE id = ?`).get(id) as object
        )[0] as string
    )
    .sort();
}

describe('id: — select by content identity', () => {
  it('a bare member key and the full IRI both resolve', async () => {
    const open = await seeded();
    try {
      const { key } = open.sqlite
        .prepare(
          `SELECT se.key AS key FROM sourced_entities se
           JOIN entities e ON e.id = se.entity_id WHERE e.cached_name = 'Pic'`
        )
        .get() as { key: string };
      expect(names(open, `id:"${key}"`)).toEqual(['Pic']);
      expect(names(open, `id:"https://data.chronicle.app/entity/${key}"`)).toEqual(['Pic']);
    } finally {
      open.close();
    }
  });

  it('composes as a traversal constraint', async () => {
    const open = await seeded();
    try {
      const { key } = open.sqlite
        .prepare(
          `SELECT se.key AS key FROM sourced_entities se
           JOIN entities e ON e.id = se.entity_id WHERE e.cached_name = 'Pic'`
        )
        .get() as { key: string };
      expect(names(open, `type:CreateAction result:{ id:"${key}" }`)).toEqual(['c1']);
    } finally {
      open.close();
    }
  });
});

describe('attachment: — stored bytes', () => {
  it('filters actions and narrows by mime class', async () => {
    const open = await seeded();
    try {
      expect(names(open, 'type:CreateAction attachment:*')).toEqual(['c1']);
      expect(names(open, 'type:CreateAction attachment:"image/*"')).toEqual(['c1']);
      expect(names(open, 'type:CreateAction attachment:"video/*"')).toEqual([]);
    } finally {
      open.close();
    }
  });

  it('filters entities by their own attachment', async () => {
    const open = await seeded();
    try {
      expect(names(open, 'type:ImageObject attachment:*')).toEqual(['Pic']);
    } finally {
      open.close();
    }
  });
});

describe('grammar traps teach', () => {
  it('a quantifier on a literal-valued field is loud, not silently empty', () => {
    expect(() => lowerQuery(parse('genre:single'))).toThrowError(/quote it/);
    expect(() => lowerQuery(parse('category:count>2{ }'))).toThrowError(/literal values/);
  });

  it('a temporal scope over a pseudo-edge is loud, not silently dropped', () => {
    expect(() => lowerQuery(parse('during(2019){ after:{ type:MoveAction } }'))).toThrowError(
      /scopes over/i
    );
  });
});

describe('unknown fields teach', () => {
  it('suggests near misses', () => {
    expect(() => lowerQuery(parse('artst:{ name:"X" }'))).toThrowError(
      /Unknown field "artst".*artist/
    );
  });

  it('errors loudly even with no close match', () => {
    expect(() => lowerQuery(parse('participant:{ name:"X" }'))).toThrowError(
      /Unknown field "participant"/
    );
  });
});
