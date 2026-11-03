import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { serializeProjection } from './json.js';

const agent = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const read = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent,
  '@key': ['source', 'sourceId'],
  ...over,
});

describe('serializeProjection', () => {
  it('repoints entity-valued references when their target merges', async () => {
    const { db, close } = makeTestDb();
    try {
      await processEvents(db, [
        // Book authored by the goodreads Orwell
        read({
          sourceId: 'r1',
          timestamp: '2023-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 'gr',
            sourceId: 'b1',
            name: '1984',
            author: [
              {
                '@type': 'Person',
                source: 'gr',
                sourceId: 'orwell',
                name: 'George Orwell',
                '@key': ['source', 'sourceId'],
              },
            ],
            '@key': ['source', 'sourceId'],
          },
        }),
        // A wikipedia Orwell carrying a url
        read({
          sourceId: 'r2',
          timestamp: '2023-02-01T00:00:00Z',
          object: {
            '@type': 'Person',
            source: 'wp',
            sourceId: 'orwell',
            url: 'https://en.wikipedia.org/wiki/George_Orwell',
            '@key': ['source', 'sourceId'],
          },
        }),
        // The goodreads Orwell gains the same url -> merges the two
        read({
          sourceId: 'r3',
          timestamp: '2023-03-01T00:00:00Z',
          object: {
            '@type': 'Person',
            source: 'gr',
            sourceId: 'orwell',
            url: 'https://en.wikipedia.org/wiki/George_Orwell',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);

      const projection = serializeProjection(db);
      const book = projection.find(e => e.types.includes('Book'))!;
      const authorRef = book.properties.author[0].ref!;

      // ref must resolve to a live entity, not a deleted (merged-away) id
      expect(authorRef).not.toContain('unresolved');

      const person = projection.find(
        e => e.types.includes('Person') && e.properties.name?.[0]?.value === 'George Orwell'
      )!;
      expect(authorRef).toBe(person.id);
    } finally {
      close();
    }
  });
});
