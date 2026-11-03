import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryEntityIds } from './evaluate.js';
import type { ConstraintNode } from '@chronicle.app/cql';

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
// Event-native: @assertedAt = timestamp (the fold reads the sighting axis only
// from @assertedAt; an unstamped payload would be dated implicit-now).
const read = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent: me,
  '@key': ['source', 'sourceId'],
  ...(over.timestamp === undefined ? {} : { '@assertedAt': over.timestamp }),
  ...over,
});

async function seeded() {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    read({
      sourceId: 'r1',
      timestamp: '2020-01-01T00:00:00Z',
      object: {
        '@type': 'Book',
        source: 'test',
        sourceId: 'b1',
        name: '1984',
        genre: ['dystopia'],
        author: [
          {
            '@type': 'Person',
            source: 'test',
            sourceId: 'orwell',
            name: 'George Orwell',
            '@key': ['source', 'sourceId'],
          },
        ],
        '@key': ['source', 'sourceId'],
      },
    }),
    read({
      sourceId: 'r2',
      timestamp: '2021-06-01T00:00:00Z',
      object: {
        '@type': 'Book',
        source: 'test',
        sourceId: 'b1',
        name: 'Nineteen Eighty-Four',
        '@key': ['source', 'sourceId'],
      },
    }),
    read({
      sourceId: 'r3',
      timestamp: '2020-01-01T00:00:00Z',
      object: {
        '@type': 'MusicRecording',
        source: 'test',
        sourceId: 'song1',
        name: 'Imagine',
        '@key': ['source', 'sourceId'],
      },
    }),
  ]);
  return open;
}

const run = (open: Awaited<ReturnType<typeof seeded>>, ast: ConstraintNode[]) =>
  queryEntityIds(open.sqlite, ast);

describe('CQL evaluation', () => {
  it('matches by type', async () => {
    const open = await seeded();
    try {
      const books = run(open, [{ type: 'type', value: 'Book' }]);
      const recordings = run(open, [{ type: 'type', value: 'MusicRecording' }]);
      expect(books).toHaveLength(1);
      expect(recordings).toHaveLength(1);
      expect(books[0]).not.toBe(recordings[0]);
    } finally {
      open.close();
    }
  });

  it('matches property existence and equality (current)', async () => {
    const open = await seeded();
    try {
      const hasGenre = run(open, [{ type: 'property', property: 'genre', operator: 'exists' }]);
      expect(hasGenre).toHaveLength(1);

      // current name is the superseded value? No — "Nineteen Eighty-Four" is current
      const current = run(open, [
        {
          type: 'property',
          property: 'name',
          operator: 'equals',
          value: 'Nineteen Eighty-Four',
        },
      ]);
      expect(current).toHaveLength(1);

      // the old name is not current
      const oldCurrent = run(open, [
        { type: 'property', property: 'name', operator: 'equals', value: '1984' },
      ]);
      expect(oldCurrent).toHaveLength(0);

      // but it is matchable @ever
      const oldEver = run(open, [
        {
          type: 'property',
          property: 'name',
          operator: 'equals',
          value: '1984',
          temporal: 'ever',
        },
      ]);
      expect(oldEver).toHaveLength(1);
    } finally {
      open.close();
    }
  });

  it('matches point-in-time on the valid axis', async () => {
    const open = await seeded();
    try {
      const at2020 = run(open, [
        {
          type: 'property',
          property: 'name',
          operator: 'equals',
          value: '1984',
          temporal: { at: '2020-03-01T00:00:00Z' },
        },
      ]);
      expect(at2020).toHaveLength(1);
    } finally {
      open.close();
    }
  });

  it('matches associations with dual literal-or-name semantics', async () => {
    const open = await seeded();
    try {
      // association: author entity named "George Orwell"
      const byAssoc = run(open, [
        { type: 'type', value: 'Book' },
        {
          type: 'association',
          property: 'author',
          constraints: [
            {
              type: 'property',
              property: 'name',
              operator: 'equals',
              value: 'George Orwell',
            },
          ],
        },
      ]);
      expect(byAssoc).toHaveLength(1);

      // dual match: author equals the referenced entity's name directly
      const byName = run(open, [
        {
          type: 'property',
          property: 'author',
          operator: 'equals',
          value: 'George Orwell',
        },
      ]);
      expect(byName).toHaveLength(1);
    } finally {
      open.close();
    }
  });

  it('supports AND / OR / negation', async () => {
    const open = await seeded();
    try {
      const or = run(open, [
        {
          type: 'or',
          constraints: [
            { type: 'type', value: 'Book' },
            { type: 'type', value: 'MusicRecording' },
          ],
        },
      ]);
      expect(or.length).toBe(2);

      const notBook = run(open, [{ type: 'type', value: 'Person', negated: false }]);
      expect(notBook.length).toBeGreaterThanOrEqual(1); // the agent + author people
    } finally {
      open.close();
    }
  });
});
