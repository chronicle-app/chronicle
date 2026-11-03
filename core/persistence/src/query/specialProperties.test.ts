import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { lowerQuery } from './cql.js';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryEntityIds } from './evaluate.js';

/**
 * Special properties are materialized as agent-property runs by an action
 * scan; the query layer probes those rows directly. chronicle.ttl declares one,
 * `liked`: a LikeAction opens it and an UnlikeAction closes it.
 */

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  name: 'Andrew',
  '@key': ['source', 'sourceId'],
};
const book = (sourceId: string, name: string) => ({
  '@type': 'Book',
  source: 'test',
  sourceId,
  name,
  '@key': ['source', 'sourceId'],
});
const action = (
  type: string,
  sourceId: string,
  timestamp: string,
  object: Record<string, unknown>
) => ({
  '@type': type,
  source: 'test',
  sourceId,
  timestamp,
  agent: me,
  object,
  '@key': ['source', 'sourceId'],
});

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    // b1: liked (2020), unliked (2021)
    action('LikeAction', 'l0', '2020-01-01T00:00:00Z', book('b1', '1984')),
    action('UnlikeAction', 'u0', '2021-01-01T00:00:00Z', book('b1', '1984')),
    // b2: read (2022); also liked, still
    action('ReadAction', 'r2', '2022-01-01T00:00:00Z', book('b2', 'Animal Farm')),
    action('LikeAction', 'l1', '2022-02-01T00:00:00Z', book('b2', 'Animal Farm')),
  ]);
  return open;
}

type Open = Awaited<ReturnType<typeof seeded>>;

const runCql = (open: Open, cql: string) => queryEntityIds(open.sqlite, lowerQuery(parse(cql)));

describe('special properties (materialized agent-property runs)', () => {
  it('liked closes on UnlikeAction; past finds the closed run', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'type:Book liked:*')).toHaveLength(1); // b2
      expect(runCql(open, 'type:Book past{ liked:* }')).toHaveLength(1); // b1
      expect(runCql(open, 'type:Book ever{ liked:* }')).toHaveLength(2);
      expect(runCql(open, 'type:Book liked:"Andrew"')).toHaveLength(1);
      expect(runCql(open, 'type:Book liked:"Nobody"')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('temporal at: probes the run interval', async () => {
    const open = await seeded();
    try {
      // mid-2020: b1 was liked; mid-2021: neither; mid-2022: b2
      expect(runCql(open, 'type:Book during(2020-06-01){ liked:* }')).toHaveLength(1);
      expect(runCql(open, 'type:Book during(2021-06-01){ liked:* }')).toHaveLength(0);
      expect(runCql(open, 'type:Book during(2022-06-01){ liked:* }')).toHaveLength(1);
    } finally {
      open.close();
    }
  });

  it('UnlikeAction closes the liked run', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        action('LikeAction', 'l1', '2022-01-01T00:00:00Z', book('b5', 'Liked Once')),
        action('UnlikeAction', 'u1', '2023-01-01T00:00:00Z', book('b5', 'Liked Once')),
      ]);
      expect(runCql(open, 'type:Book liked:*')).toHaveLength(0);
      expect(runCql(open, 'type:Book past{ liked:* }')).toHaveLength(1);
      expect(runCql(open, 'type:Book during(2022-06-01){ liked:* }')).toHaveLength(1);
    } finally {
      open.close();
    }
  });
});
