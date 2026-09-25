import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SqliteExtractor,
  getRow,
  isSqliteBusy,
  iterateRows,
  timeRangeConditions,
} from '../dist/index.js';

class FixtureExtractor extends SqliteExtractor {
  static source = 'fixture';
  static strategy = 'database';
  async *extract() {
    const { conditions, values } = timeRangeConditions('at', this.config);
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const limit = this.getEffectiveLimit();
    const stmt = this.db.prepare(
      `SELECT * FROM events${where} ORDER BY at${limit ? ' LIMIT ?' : ''}`
    );
    if (limit) values.push(limit);
    for (const row of iterateRows(stmt, ...values)) yield this.createRecord(row);
  }

  write() {
    this.db.exec('DELETE FROM events');
  }

  connection() {
    return this.db;
  }
}

function fixture(t, wal = false) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-sqlite-'));
  const input = join(dir, 'fixture.db');
  const db = new DatabaseSync(input);
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
  db.exec(
    'CREATE TABLE events (id INTEGER, at INTEGER); INSERT INTO events VALUES (1, 0), (2, 1), (3, 2);'
  );
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, input, db };
}

async function collect(extractor) {
  const records = [];
  for await (const record of extractor.extract()) records.push(record.data.id);
  return records;
}

test('reads and filters records, supports zero/unlimited, and rejects writes', async t => {
  const { input } = fixture(t);
  const before = readFileSync(input);
  for (const [config, expected] of [
    [{}, [1, 2, 3]],
    [{ limit: 0 }, [1, 2, 3]],
    [{ limit: 1 }, [1]],
    [{ since: new Date(0), until: new Date(2000) }, [2]],
  ]) {
    const extractor = new FixtureExtractor({ input, ...config });
    try {
      await extractor.setup();
      assert.deepEqual(await collect(extractor), expected);
      assert.throws(() => extractor.write(), /readonly|read-only/i);
      await assert.rejects(extractor.setup(), /already initialized/);
    } finally {
      await extractor.teardown();
      await extractor.teardown();
    }
    assert.equal(extractor.connection(), null);
  }
  assert.deepEqual(readFileSync(input), before);
});

test('reads uncheckpointed WAL data while writer remains open', async t => {
  const { input, db } = fixture(t, true);
  const extractor = new FixtureExtractor({ input });
  try {
    await extractor.setup();
    assert.deepEqual(await collect(extractor), [1, 2, 3]);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  } finally {
    await extractor.teardown();
  }
});

test('missing database is not created and failed setup can be torn down', async t => {
  const { dir } = fixture(t);
  const input = join(dir, 'missing.db');
  const extractor = new FixtureExtractor({ input });
  await assert.rejects(extractor.setup());
  await extractor.teardown();
  assert.equal(existsSync(input), false);
});

function lock(db) {
  db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
  return () => db.exec('ROLLBACK');
}

test('a locked source is detected as busy and subclasses can fall back to a copy', async t => {
  const { dir, input, db } = fixture(t);
  const copy = join(dir, 'copy.db');
  class CopyingExtractor extends FixtureExtractor {
    async setup() {
      await super.setup();
      try {
        getRow(this.db.prepare('SELECT 1 FROM sqlite_schema'));
      } catch (error) {
        if (!isSqliteBusy(error)) throw error;
        this.db.close();
        this.db = null;
        copyFileSync(input, copy);
        this.db = this.openDatabase(copy);
      }
    }
  }
  const unlock = lock(db);
  const extractor = new CopyingExtractor({ input });
  try {
    await extractor.setup();
    assert.equal(existsSync(copy), true);
    assert.deepEqual(await collect(extractor), [1, 2, 3]);
    assert.throws(() => extractor.write(), /readonly|read-only/i);
  } finally {
    await extractor.teardown();
    unlock();
  }
  // Other SQLite errors must not be mistaken for a lock and silently copied.
  assert.throws(
    () => new DatabaseSync(':memory:').prepare('SELECT * FROM missing'),
    error => !isSqliteBusy(error)
  );
  assert.equal(extractor.connection(), null);
});
