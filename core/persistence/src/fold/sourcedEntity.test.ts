import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

function sourcedRows(sqlite: any, where = '1=1'): any[] {
  return sqlite
    .prepare(
      `SELECT source, source_id, handle, key, keyset, type FROM sourced_entities WHERE ${where}`
    )
    .all();
}

const read = (sourceId: string, object: Record<string, unknown>, assertedAt?: string) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent: { '@type': 'Person', source: 'test', sourceId: 'me', '@key': ['source', 'sourceId'] },
  '@key': ['source', 'sourceId'],
  sourceId,
  timestamp: '2023-01-01T00:00:00Z',
  ...(assertedAt === undefined ? {} : { '@assertedAt': assertedAt }),
  object,
});

describe('sourced_entities.source_id', () => {
  it('persists the top-level sourceId when it is a keyset member', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        read('r1', {
          '@type': 'Book',
          source: 'books',
          sourceId: 'book-1',
          '@key': ['source', 'sourceId'],
        })
      );
      const [row] = sourcedRows(sqlite, "source = 'books'");
      expect(row.source_id).toBe('book-1');
    } finally {
      close();
    }
  });

  it('persists the top-level sourceId when the keyset does not include it', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        read('r1', {
          '@type': 'Article',
          source: 'reader',
          sourceId: 'item-9',
          url: 'https://example.com/a',
          '@key': ['url'],
        })
      );
      // `@key: ["url"]` normalizes to the `url` namespace identity, which still
      // records the record's own sourceId.
      const [row] = sourcedRows(sqlite, "source = 'url'");
      expect(JSON.parse(row.keyset)).toEqual({ source: 'url', url: 'https://example.com/a' });
      expect(row.source).toBe('url');
      expect(row.source_id).toBe('item-9');
    } finally {
      close();
    }
  });

  it('gives a sameAs alias hub its own keyset sourceId and a namespaced url identity none', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        read('r1', {
          '@type': 'Person',
          source: 'icloud',
          sourceId: 'p1',
          url: 'https://example.com/p1',
          '@key': ['source', 'sourceId'],
          sameAs: [
            {
              '@type': 'Person',
              source: 'email',
              sourceId: 'e1',
              '@key': ['@type', 'source', 'sourceId'],
            },
          ],
        })
      );
      const [alias] = sourcedRows(sqlite, "source = 'email'");
      expect(alias.source_id).toBe('e1');
      const [urlHub] = sourcedRows(sqlite, "source = 'url' AND type = 'Entity'");
      expect(urlHub.source).toBe('url');
      expect(JSON.parse(urlHub.keyset)).toEqual({ source: 'url', url: 'https://example.com/p1' });
      expect(urlHub.source_id).toBeNull();
    } finally {
      close();
    }
  });
});

describe('sourced_entities.handle', () => {
  it('persists the top-level handle when the keyset does not include it', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Slack-shaped: keyed by sourceId, handle emitted alongside
      await processEvent(
        db,
        read('r1', {
          '@type': 'Person',
          source: 'slack',
          sourceId: 'U0AGENT',
          handle: 'eric.blair',
          '@key': ['@type', 'source', 'sourceId'],
        })
      );
      const [row] = sourcedRows(sqlite, "source = 'slack'");
      expect(JSON.parse(row.keyset)).not.toHaveProperty('handle');
      expect(row.handle).toBe('eric.blair');
    } finally {
      close();
    }
  });

  it('gives a sameAs alias hub its own keyset handle and a namespaced url identity none', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        read('r1', {
          '@type': 'Person',
          source: 'icloud',
          sourceId: 'p1',
          url: 'https://example.com/p1',
          '@key': ['source', 'sourceId'],
          sameAs: [
            {
              '@type': 'Person',
              source: 'twitter',
              handle: 'orwell',
              '@key': ['@type', 'source', 'handle'],
            },
          ],
        })
      );
      const [alias] = sourcedRows(sqlite, "source = 'twitter'");
      expect(alias.handle).toBe('orwell');
      const [urlHub] = sourcedRows(sqlite, "source = 'url' AND type = 'Entity'");
      expect(urlHub.handle).toBeNull();
    } finally {
      close();
    }
  });

  it('latest sighting wins on a rename; a sighting without one is not a rename', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const person = (handle?: string) => ({
        '@type': 'Person',
        source: 'slack',
        sourceId: 'U0AGENT',
        ...(handle === undefined ? {} : { handle }),
        '@key': ['@type', 'source', 'sourceId'],
      });
      // Stamped apart: two implicit-now stamps can share a millisecond.
      await processEvent(db, read('r1', person('eric.blair'), '2024-01-01T00:00:00Z'));
      await processEvent(db, read('r2', person('george.orwell'), '2024-01-02T00:00:00Z'));
      expect(sourcedRows(sqlite, "source = 'slack'")[0].handle).toBe('george.orwell');
      // silence: a later record without a handle keeps the stored one
      await processEvent(db, read('r3', person(), '2024-01-03T00:00:00Z'));
      expect(sourcedRows(sqlite, "source = 'slack'")[0].handle).toBe('george.orwell');
    } finally {
      close();
    }
  });
});
