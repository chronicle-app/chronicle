import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafariExtractor, SafariTransformer } from '../dist/index.js';

const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
const JAN_1 = 757_382_400;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'safari-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'History.db');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE history_items (id INTEGER PRIMARY KEY, url TEXT);
    CREATE TABLE history_visits (id INTEGER PRIMARY KEY, history_item INTEGER,
      visit_time REAL, title TEXT, redirect_destination INTEGER, origin INTEGER);
    INSERT INTO history_items VALUES (1, 'https://example.com/a'), (2, 'https://example.com/b'),
      (3, 'http://example.com/old');
    INSERT INTO history_visits VALUES
      (1, 1, ${JAN_1 + 1.25}, 'Page A', NULL, 0),
      (2, 2, ${JAN_1 + 2}, NULL, NULL, 1),
      (3, 3, ${JAN_1 + 3}, NULL, 4, 0),
      (4, 2, ${JAN_1 + 3}, 'Page B', NULL, 0);
  `);
  db.close();
  return input;
}

async function records(input, config = {}) {
  const extractor = new SafariExtractor({ input, account, ...config });
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

test('visits become schema-valid ViewActions, newest first', async t => {
  const input = fixture(t);
  const rows = await records(input);
  // Redirect hop 3 is skipped; newest first.
  assert.deepEqual(
    rows.map(r => r.data.visit_id),
    [4, 2, 1]
  );

  const transformer = new SafariTransformer();
  const [view] = await transformer.performTransform(rows.at(-1));
  assert.deepEqual(view.data, {
    '@type': 'ViewAction',
    timestamp: new Date('2025-01-01T00:00:01Z'),
    '@key': ['@type', 'source', 'timestamp'],
    source: 'safari',
    agent: {
      '@type': 'Person',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'icloud',
      sourceId: '1234567890',
      handle: 'you@example.com',
      sameAs: ['@me'],
    },
    object: {
      '@type': 'Entity',
      '@key': ['url'],
      url: 'https://example.com/a',
      name: 'Page A',
    },
  });

  // since/until are converted to Safari's Apple-epoch visit times.
  const since = new Date('2025-01-01T00:00:02.500Z');
  assert.deepEqual(
    (await records(input, { since })).map(r => r.data.visit_id),
    [4]
  );
});
