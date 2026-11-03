import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { lowerQuery } from './cql.js';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryEntityIds } from './evaluate.js';

/**
 * source / sourceId / handle are structural keys, not predicates: each is its
 * own column on `sourced_entities`. They are never shredded into `properties`,
 * so the entity query path resolves them by joining `sourced_entities`
 * (compileSourced) rather than the property path that backs ordinary
 * predicates.
 */

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  name: 'Andrew',
  '@key': ['source', 'sourceId'],
};

const grBook = {
  '@type': 'Book',
  source: 'goodreads',
  sourceId: '12345',
  name: '1984',
  '@key': ['source', 'sourceId'],
};
const olBook = {
  '@type': 'Book',
  source: 'openlibrary',
  sourceId: 'OL999',
  name: 'Animal Farm',
  '@key': ['source', 'sourceId'],
};
const handlePerson = {
  '@type': 'Person',
  source: 'twitter',
  handle: 'orwell',
  name: 'George Orwell',
  '@key': ['source', 'handle'],
};
// Slack-shaped: keyed by sourceId, handle emitted alongside — the handle is not
// a keyset member, so only the column (not the keyset JSON) can answer for it.
const slackPerson = {
  '@type': 'Person',
  source: 'slack',
  sourceId: 'U0AGENT',
  handle: 'eric.blair',
  name: 'Eric Blair',
  '@key': ['@type', 'source', 'sourceId'],
};

const read = (sourceId: string, object: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  sourceId,
  timestamp: '2020-01-01T00:00:00Z',
  agent: me,
  object,
  '@key': ['source', 'sourceId'],
});

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    read('r1', grBook),
    read('r2', olBook),
    read('r3', handlePerson),
    read('r4', slackPerson),
  ]);
  return open;
}

type Open = Awaited<ReturnType<typeof seeded>>;

const runCql = (open: Open, cql: string) => queryEntityIds(open.sqlite, lowerQuery(parse(cql)));

describe('sourced identity (source / sourceId / handle)', () => {
  it('source matches entities by their per-source provenance', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'type:Book source:goodreads')).toHaveLength(1);
      expect(runCql(open, 'type:Book source:openlibrary')).toHaveLength(1);
      expect(runCql(open, 'type:Book source:nope')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('sourceId matches the keyset value', async () => {
    const open = await seeded();
    try {
      expect(runCql(open, 'source:goodreads sourceId:12345')).toHaveLength(1);
      expect(runCql(open, 'sourceId:OL999')).toHaveLength(1);
      expect(runCql(open, 'sourceId:missing')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('handle matches whether or not it is a keyset member', async () => {
    const open = await seeded();
    try {
      // keyset member (twitter, @key includes handle)
      expect(runCql(open, 'handle:orwell')).toHaveLength(1);
      // not a keyset member (slack, keyed by sourceId, handle alongside)
      expect(runCql(open, 'handle:eric.blair')).toHaveLength(1);
      expect(runCql(open, 'handle:somebodyelse')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('negation excludes a source', async () => {
    const open = await seeded();
    try {
      // two Books total; one is goodreads, so -source:goodreads leaves the other
      expect(runCql(open, 'type:Book -source:goodreads')).toHaveLength(1);
    } finally {
      open.close();
    }
  });
});
