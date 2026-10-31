/**
 * `with:{…}` co-occurrence over the encounters log. No window =
 * co-participation in one originating action (a listen's transitive encounters
 * put song and artist in the same event); `with(<gap>):{…}` matches encounters
 * within that distance in time. The anchor itself is excluded — the question
 * is who ELSE was around.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { lowerQuery, queryPage } from './cql.js';
import { UnsupportedConstraintError } from './evaluate.js';

const KEY = { '@key': ['source', 'sourceId'] };
const me = { '@type': 'Person', source: 't', sourceId: 'me', name: 'Me', sameAs: ['@me'], ...KEY };

const artist = { '@type': 'MusicGroup', source: 't', sourceId: 'r', name: 'Radiant', ...KEY };
const song = {
  '@type': 'MusicRecording',
  source: 't',
  sourceId: 's',
  name: 'Signal',
  artist: [artist],
  ...KEY,
};
const book = { '@type': 'Book', source: 't', sourceId: 'b', name: 'Nearby Book', ...KEY };
const article = { '@type': 'Article', source: 't', sourceId: 'a', name: 'Far Article', ...KEY };

const act = (type: string, sourceId: string, timestamp: string, object: object) => ({
  '@type': type,
  source: 't',
  sourceId,
  timestamp,
  '@assertedAt': timestamp,
  agent: me,
  object,
  ...KEY,
});

const EVENTS = [
  act('ListenAction', 'l1', '2024-05-10T12:00:00Z', song),
  act('ReadAction', 'r1', '2024-05-10T14:00:00Z', book), // 2h after the listen
  act('ViewAction', 'v1', '2024-05-15T12:00:00Z', article), // 5d after
];

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, EVENTS);
  return open;
}

function names(open: ReturnType<typeof openDatabase>, cql: string): string[] {
  const out = queryPage(open.sqlite, parse(cql), { limit: 50 });
  return out.ids
    .map(
      id =>
        (
          open.sqlite.prepare('SELECT cached_name AS n FROM entities WHERE id = ?').get(id) as {
            n: string;
          }
        ).n
    )
    .sort();
}

describe('with: co-occurrence', () => {
  it('an empty anchor teaches', async () => {
    expect(() => lowerQuery(parse('with:{ type:Book }'))).not.toThrow();
    const open = await seeded();
    try {
      expect(() => names(open, 'with:{ }')).toThrow(UnsupportedConstraintError);
    } finally {
      open.close();
    }
  });
});
