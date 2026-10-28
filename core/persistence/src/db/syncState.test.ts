import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { rebuildDerived } from '../fold/fold.js';
import { crossSourceMerge } from '../testing/examples.js';
import { DERIVED_TABLES } from './migrate.js';

describe('sync_state', () => {
  it('is not listed among the derived tables', () => {
    expect(DERIVED_TABLES as readonly string[]).not.toContain('sync_state');
  });

  it('lives in the ops sidecar, untouched by a derived-state wipe + rebuild', async () => {
    const { db, sqlite, opsSqlite, close } = makeTestDb();
    try {
      await processEvents(db, crossSourceMerge);
      expect(
        sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sync_state'").get()
      ).toBeUndefined();
      opsSqlite
        .prepare('INSERT INTO sync_state (key, value) VALUES (?, ?)')
        .run('pull_seq', '4271');

      rebuildDerived(db); // drops every DERIVED_TABLE and re-folds the log

      const row = opsSqlite
        .prepare('SELECT value FROM sync_state WHERE key = ?')
        .get('pull_seq') as { value: string } | undefined;
      expect(row?.value).toBe('4271'); // cursor untouched by the rebuild
    } finally {
      close();
    }
  });
});
