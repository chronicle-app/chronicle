import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { rebuildDerived } from '../fold/fold.js';
import { crossSourceMerge } from '../testing/examples.js';
import { DERIVED_TABLES } from './migrate.js';

describe('blob_cache', () => {
  it('is not listed among the derived tables', () => {
    expect(DERIVED_TABLES as readonly string[]).not.toContain('blob_cache');
  });

  it('lives in the ops sidecar, untouched by a derived-state wipe + rebuild', async () => {
    const { db, sqlite, opsSqlite, close } = makeTestDb();
    try {
      await processEvents(db, crossSourceMerge);
      expect(
        sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'blob_cache'").get()
      ).toBeUndefined();
      opsSqlite
        .prepare('INSERT INTO blob_cache (cid, pinned, accessed_at) VALUES (?, ?, ?)')
        .run('bafkreiexamplecid', 1, 1234);

      rebuildDerived(db); // drops every DERIVED_TABLE and re-folds the log

      const row = opsSqlite
        .prepare('SELECT pinned, accessed_at AS accessedAt FROM blob_cache WHERE cid = ?')
        .get('bafkreiexamplecid') as { pinned: number; accessedAt: number } | undefined;
      expect(row).toEqual({ pinned: 1, accessedAt: 1234 }); // untouched by the rebuild
    } finally {
      close();
    }
  });
});
