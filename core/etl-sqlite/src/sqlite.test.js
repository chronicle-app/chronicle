import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SqliteExtractor,
  timeRangeConditions,
  iosToUnixTimestamp,
  unixToIosTimestamp,
  safariToUnixTimestamp,
  unixToSafariTimestamp,
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
    for (const row of stmt.iterate(...values)) yield this.createRecord(row);
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

test('large integer timestamps can be read without loss', async t => {
  const { input, db } = fixture(t);
  db.exec(
    'CREATE TABLE timestamps (value INTEGER); INSERT INTO timestamps VALUES (800000000000000001);'
  );
  const extractor = new FixtureExtractor({ input });
  try {
    await extractor.setup();
    const stmt = extractor.connection().prepare('SELECT value FROM timestamps');
    stmt.setReadBigInts(true);
    assert.equal(stmt.get().value, 800_000_000_000_000_001n);
  } finally {
    await extractor.teardown();
  }
});

test('time bounds parameterize epoch zero, conversions and inclusive endpoints', () => {
  assert.deepEqual(timeRangeConditions('at', {}), { conditions: [], values: [] });
  assert.deepEqual(
    timeRangeConditions(
      'at',
      { since: 0, until: '1970-01-01T00:00:02Z' },
      { sinceOp: '>=', untilOp: '<=' }
    ),
    {
      conditions: ['at >= ?', 'at <= ?'],
      values: [0, 2],
    }
  );
  assert.deepEqual(
    timeRangeConditions('at', { since: 0 }, { convert: d => d.toISOString() }).values,
    ['1970-01-01T00:00:00.000Z']
  );
  assert.throws(() => timeRangeConditions('at', { since: 'invalid' }), /Invalid time/);
});

test('Apple epoch conversions match known dates and round-trip', () => {
  const seconds = Date.parse('2026-06-01T00:00:00Z') / 1000;
  assert.equal(iosToUnixTimestamp(0), Date.parse('2001-01-01T00:00:00Z'));
  assert.equal(iosToUnixTimestamp(unixToIosTimestamp(seconds)), seconds * 1000);
  assert.equal(safariToUnixTimestamp(unixToSafariTimestamp(seconds)), seconds);
});
