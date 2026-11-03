import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { lowerQuery } from './cql.js';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryActionIds, queryEntityIds } from './evaluate.js';

/**
 * The `@me` query token resolves to the self hub and
 * compiles to a direct entity-id comparison — identity, not name. `liked:@me`
 * reuses the same anchor over the `liked` special property.
 *
 * `self` is tagged `@me`; `impostor` shares the name "Andrew" but no `@me` tag,
 * so it is a different entity — the lever that separates identity from name.
 */
const self = {
  '@type': 'Person',
  source: 'slack',
  sourceId: 'U_ME',
  name: 'Andrew',
  sameAs: ['@me'],
  '@key': ['source', 'sourceId'],
};
const impostor = {
  '@type': 'Person',
  source: 'slack',
  sourceId: 'U_OTHER',
  name: 'Andrew',
  '@key': ['source', 'sourceId'],
};
const person = (sourceId: string, name: string) => ({
  '@type': 'Person',
  source: 'slack',
  sourceId,
  name,
  '@key': ['source', 'sourceId'],
});
const book = (sourceId: string, name: string) => ({
  '@type': 'Book',
  source: 'slack',
  sourceId,
  name,
  '@key': ['source', 'sourceId'],
});
const action = (
  type: string,
  sourceId: string,
  agent: Record<string, unknown>,
  object: Record<string, unknown>
) => ({
  '@type': type,
  source: 'slack',
  sourceId,
  timestamp: '2022-01-01T00:00:00Z',
  agent,
  object,
  '@key': ['source', 'sourceId'],
});

const alice = person('U_ALICE', 'Alice');
const bob = person('U_BOB', 'Bob');

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    // self: reads + likes 1984; likes Alice.
    action('ReadAction', 'r1', self, book('b1', '1984')),
    action('LikeAction', 'c1', self, book('b1', '1984')),
    action('LikeAction', 'f1', self, alice),
    // impostor (same name, not @me): reads + likes Animal Farm; likes Bob;
    // and directs a LikeAction at self (gives us an `object:@me` row).
    action('ReadAction', 'r2', impostor, book('b2', 'Animal Farm')),
    action('LikeAction', 'c2', impostor, book('b2', 'Animal Farm')),
    action('LikeAction', 'f2', impostor, bob),
    action('LikeAction', 'l1', impostor, self),
  ]);
  return open;
}

type Open = Awaited<ReturnType<typeof seeded>>;

const entities = (open: Open, cql: string) => queryEntityIds(open.sqlite, lowerQuery(parse(cql)));
const actions = (open: Open, cql: string) => queryActionIds(open.sqlite, lowerQuery(parse(cql)));

describe('@me query token', () => {
  it('agent:@me filters action rows by the self entity, not by name', async () => {
    const open = await seeded();
    try {
      // self performed 3 actions (read, like, like).
      expect(actions(open, 'agent:@me')).toHaveLength(3);
      // name match is broader: both Andrews act (4 impostor actions + 3 self).
      expect(actions(open, 'agent:"Andrew"')).toHaveLength(7);
    } finally {
      open.close();
    }
  });

  it('type:Book liked:@me returns only the self-liked book', async () => {
    const open = await seeded();
    try {
      expect(entities(open, 'type:Book liked:@me')).toHaveLength(1);
      // ...and it is 1984 (self), not Animal Farm (impostor, same name).
      expect(entities(open, 'type:Book liked:@me name:"1984"')).toHaveLength(1);
      expect(entities(open, 'type:Book liked:@me name:"Animal Farm"')).toHaveLength(0);
      // the name-scoped form would wrongly include both.
      expect(entities(open, 'type:Book liked:"Andrew"')).toHaveLength(2);
    } finally {
      open.close();
    }
  });

  it('object:@me filters by the object role', async () => {
    const open = await seeded();
    try {
      // only the impostor's LikeAction is directed at self.
      expect(actions(open, 'object:@me')).toHaveLength(1);
    } finally {
      open.close();
    }
  });

  it('no self anchor → a teaching error, never a silent empty', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      // No @me-tagged node ingested: `[]` here would read as "you have no
      // history" when it means "nothing is tagged" — say so out loud.
      await processEvents(open.db, [action('ReadAction', 'r1', impostor, book('b1', '1984'))]);
      expect(() => actions(open, 'agent:@me')).toThrowError(/no self-hub/);
      expect(() => entities(open, 'type:Book liked:@me')).toThrowError(/no self-hub/);
    } finally {
      open.close();
    }
  });
});

describe('liked:@me — egocentric like lookup', () => {
  it('type:Person liked:@me returns people the self entity likes', async () => {
    const open = await seeded();
    try {
      // self likes Alice; impostor likes Bob.
      expect(entities(open, 'type:Person liked:@me')).toHaveLength(1);
      expect(entities(open, 'type:Person liked:@me name:"Alice"')).toHaveLength(1);
      expect(entities(open, 'type:Person liked:@me name:"Bob"')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('liked:{ name:…) scopes by the acting agent name (both Andrews)', async () => {
    const open = await seeded();
    try {
      // name scope catches every "Andrew" like: Alice (self) + Bob and self (impostor).
      expect(entities(open, 'type:Person liked:"Andrew"')).toHaveLength(3);
    } finally {
      open.close();
    }
  });
});
