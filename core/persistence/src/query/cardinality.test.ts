import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { lowerQuery } from './cql.js';
import { queryActionIds, queryEntityIds } from './evaluate.js';

/**
 * `field:count<op>n` counts each subject's matching neighbors in one grouped
 * pass. A subject with no neighbor has no group, so a comparison that zero
 * satisfies must still keep it — the case these messages pin down.
 */

const KEY = { '@key': ['source', 'sourceId'] };
const person = (id: string) => ({
  '@type': 'Person',
  source: 'test',
  sourceId: id,
  name: id,
  ...KEY,
});
const message = (id: string, recipients: string[]) => ({
  '@type': 'MessageAction',
  source: 'test',
  sourceId: id,
  timestamp: '2024-01-01T00:00:00Z',
  agent: person('me'),
  object: {
    '@type': 'Message',
    source: 'test',
    sourceId: `m-${id}`,
    body: id,
    ...(recipients.length > 0 ? { recipient: recipients.map(r => person(r)) } : {}),
    ...KEY,
  },
  ...KEY,
});

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    message('none', []),
    message('one', ['ann']),
    message('three', ['ann', 'bo', 'cy']),
  ]);
  return open;
}

type Open = Awaited<ReturnType<typeof seeded>>;

const bodies = (open: Open, cql: string) =>
  queryEntityIds(open.sqlite, lowerQuery(parse(`type:Message ${cql}`)))
    .map(id => {
      const row = open.sqlite
        .prepare(
          `SELECT json_extract(v.body, '$') AS body FROM properties p JOIN vals v ON v.id = p.value_id
            WHERE p.cached_entity_id = ? AND p.predicate = 'body'`
        )
        .get(id) as { body: string };
      return row.body;
    })
    .sort();

describe('cardinality over neighbors', () => {
  it('counts every comparison, keeping the subjects with none when zero passes', async () => {
    const open = await seeded();
    try {
      expect(bodies(open, 'recipient:count=0')).toEqual(['none']);
      expect(bodies(open, 'recipient:count<2')).toEqual(['none', 'one']);
      expect(bodies(open, 'recipient:count<=1')).toEqual(['none', 'one']);
      expect(bodies(open, 'recipient:count>=1')).toEqual(['one', 'three']);
      expect(bodies(open, 'recipient:count>1')).toEqual(['three']);
      expect(bodies(open, 'recipient:count=3')).toEqual(['three']);
      expect(bodies(open, '-recipient:count>1')).toEqual(['none', 'one']);
      // only the neighbors that match count
      expect(bodies(open, 'recipient:count=1{ name:"bo" }')).toEqual(['three']);
      expect(bodies(open, 'recipient:count=0{ name:"bo" }')).toEqual(['none', 'one']);
    } finally {
      open.close();
    }
  });

  it('counts the same inside an action role', async () => {
    const open = await seeded();
    try {
      const actions = (cql: string) =>
        queryActionIds(open.sqlite, lowerQuery(parse(`type:MessageAction ${cql}`))).length;
      expect(actions('object:{ recipient:count=0 }')).toBe(1);
      expect(actions('object:{ recipient:count<4 }')).toBe(3);
      expect(actions('object:{ recipient:count>0 }')).toBe(2);
    } finally {
      open.close();
    }
  });
});
