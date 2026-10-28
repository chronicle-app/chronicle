import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

const me = { '@type': 'Person', source: 'test', sourceId: 'me', '@key': ['source', 'sourceId'] };

const bookmark = (object: Record<string, unknown>) => ({
  '@type': 'BookmarkAction',
  source: 'test',
  sourceId: 'bk',
  timestamp: '2026-01-01T00:00:00.000Z',
  agent: me,
  '@key': ['source', 'sourceId'],
  object,
});

const nameOf = (sqlite: any, source: string, sourceId: string): string | null =>
  (
    sqlite
      .prepare(
        `SELECT e.cached_name AS name
           FROM entities e
           JOIN sourced_entities se ON se.entity_id = e.id
          WHERE se.source = ? AND se.source_id = ?`
      )
      .get(source, sourceId) as { name: string | null } | undefined
  )?.name ?? null;

describe('elected display name', () => {
  it('never elects a message body as the entity name', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        bookmark({
          '@type': 'Message',
          source: 'imessage',
          sourceId: 'm1',
          body: 'looks like you are brewing some rainy thundery weather for us',
          '@key': ['source', 'sourceId'],
        })
      );
      // The body is content, not a name — the message stays nameless.
      expect(nameOf(sqlite, 'imessage', 'm1')).toBeNull();
    } finally {
      close();
    }
  });

  it('still elects a real `name` as the display name', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        bookmark({
          '@type': 'Post',
          source: 'test',
          sourceId: 'p1',
          name: 'a text-only post',
          '@key': ['source', 'sourceId'],
        })
      );
      expect(nameOf(sqlite, 'test', 'p1')).toBe('a text-only post');
    } finally {
      close();
    }
  });
});
