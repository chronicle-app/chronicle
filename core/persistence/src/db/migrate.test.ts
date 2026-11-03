import Database from './nodeSqlite.js';
import { describe, expect, it } from 'vitest';
import { applySchema, SCHEMA_DDL } from './migrate.js';

const columns = (sqlite: Database.Database, table: string): string[] =>
  (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);

const viewSql = (sqlite: Database.Database, name: string): string =>
  (
    sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?").get(name) as {
      sql: string;
    }
  ).sql;

describe('applySchema — a log that still lifts `source` onto the assertions row', () => {
  it('drops the column in place, keeping the rows and rewriting the view that read it', () => {
    const sqlite = new Database(':memory:');
    try {
      // A store folded under the older shape: `source` NOT NULL on the log, and
      // the observations view reading it off the row.
      sqlite.exec(SCHEMA_DDL);
      sqlite.exec("ALTER TABLE assertions ADD COLUMN source TEXT NOT NULL DEFAULT ''");
      sqlite.exec(
        'CREATE VIEW debug_observations AS SELECT ev.source AS event_source FROM assertions ev'
      );
      sqlite
        .prepare(
          `INSERT INTO assertions (cid, kind, claim_cid, target_key, source, asserted_at, ingested_at)
           VALUES ('cid-legacy', 'assert', 'claim-1', 'key-1', 'legacy', 1, 1)`
        )
        .run();
      expect(columns(sqlite, 'assertions')).toContain('source');

      applySchema(sqlite);

      expect(columns(sqlite, 'assertions')).not.toContain('source');
      expect(sqlite.prepare('SELECT cid FROM assertions').all()).toEqual([{ cid: 'cid-legacy' }]);
      expect(viewSql(sqlite, 'debug_observations')).not.toContain('ev.source');
      expect(viewSql(sqlite, 'debug_observations')).toContain("json_extract(ep.body, '$.source')");

      // The current shape inserts, and a second open is a no-op.
      sqlite
        .prepare(
          `INSERT INTO assertions (cid, kind, claim_cid, target_key, asserted_at, ingested_at)
           VALUES ('cid-current', 'assert', 'claim-2', 'key-2', 2, 2)`
        )
        .run();
      applySchema(sqlite);
      expect(columns(sqlite, 'assertions')).not.toContain('source');
      expect(sqlite.prepare('SELECT count(*) AS n FROM assertions').get()).toEqual({ n: 2 });
    } finally {
      sqlite.close();
    }
  });

  it('is a no-op on a current store', () => {
    const sqlite = new Database(':memory:');
    try {
      applySchema(sqlite);
      const before = columns(sqlite, 'assertions');
      expect(before).not.toContain('source');
      applySchema(sqlite);
      expect(columns(sqlite, 'assertions')).toEqual(before);
    } finally {
      sqlite.close();
    }
  });
});
