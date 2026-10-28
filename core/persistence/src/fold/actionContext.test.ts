import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent } from '../process.js';

// Mirrors the shell plugin shape: the Command entity dedupes partly on
// `action.timestamp`, so two identical commands at different times must remain
// distinct entities — which only works if the fold passes the action context
// into keyset extraction.
const execAction = (timestamp: string, body: string) => ({
  '@type': 'ExecuteAction',
  source: 'shell',
  timestamp,
  '@key': ['@type', 'source', 'timestamp'],
  agent: {
    '@type': 'Person',
    source: 'shell',
    handle: 'me',
    '@key': ['@type', 'source', 'handle'],
  },
  object: {
    '@type': 'Command',
    source: 'shell',
    body,
    '@key': ['@type', 'source', 'body', 'action.timestamp'],
  },
});

describe('action-context keyset extraction', () => {
  it('keeps same-body commands distinct via action.timestamp', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, execAction('2024-01-01T00:00:00Z', 'ls'));
      await processEvent(db, execAction('2024-01-02T00:00:00Z', 'ls'));

      const commands = (
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM sourced_entities WHERE type = 'Command'")
          .get() as { n: number }
      ).n;
      expect(commands).toBe(2); // distinct because action.timestamp differs
    } finally {
      close();
    }
  });

  it('collapses identical command at the same timestamp (idempotent)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, execAction('2024-01-01T00:00:00Z', 'ls'));
      await processEvent(db, execAction('2024-01-01T00:00:00Z', 'ls'));
      const commands = (
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM sourced_entities WHERE type = 'Command'")
          .get() as { n: number }
      ).n;
      expect(commands).toBe(1);
    } finally {
      close();
    }
  });
});
