import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafariBookmarksExtractor, SafariExtractor, SafariTransformer } from '../dist/index.js';
import { monthKey } from '@chronicle.app/etl';
import { writeSchemaDatabase } from '@chronicle.app/etl-sqlite';
import { writeBookmarksFixture } from './fixture.test-helper.js';

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

async function survey(input, config = {}, options = {}) {
  const extractor = new SafariExtractor({ input, account, ...config });
  try {
    await extractor.setup();
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}
const surveyBy = input => survey(input, {}, { byMonth: true });

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
    '@assertedAt': new Date('2025-01-01T00:00:01Z'),
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

test('a survey counts the visits a run reads, when, and to how many pages', async t => {
  const input = fixture(t);
  const rows = await records(input);
  const times = rows.map(r => r.data.unix_timestamp * 1000);
  assert.deepEqual(await survey(input, { limit: 1 }), {
    views: {
      count: rows.length,
      earliest: new Date(Math.min(...times)),
      latest: new Date(Math.max(...times)),
      measures: [{ key: 'pages', label: 'pages', value: new Set(rows.map(r => r.data.url)).size }],
    },
  });
  // By month when asked, by the time of each visit, in local time.
  const months = {};
  for (const time of times)
    months[monthKey(new Date(time))] = (months[monthKey(new Date(time))] ?? 0) + 1;
  assert.deepEqual((await surveyBy(input)).views.byMonth, months);
  const since = new Date('2025-01-01T00:00:01.500Z');
  assert.equal(
    (await survey(input, { since })).views.count,
    (await records(input, { since })).length
  );
});

test('its declared schema is all its queries read, and a History.db without it is refused', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'safari-schema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const [schema] = SafariExtractor.databases;
  const input = join(dir, 'History.db');
  writeSchemaDatabase(input, schema, { optional: false });
  assert.deepEqual(await records(input), []);
  assert.equal((await surveyBy(input)).views.count, 0);

  // An older Safari's, say, without a column its queries read.
  const older = join(dir, 'older.db');
  const visits = schema.tables.history_visits.filter(column => column !== 'origin');
  writeSchemaDatabase(older, { tables: { ...schema.tables, history_visits: visits } });
  await assert.rejects(records(older), {
    message: /version of the database/,
    fields: { path: older, missing: ['history_visits.origin'] },
  });
});

async function withBookmarks(t, config, read) {
  const dir = mkdtempSync(join(tmpdir(), 'safari-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bookmarksFile = writeBookmarksFixture(dir);
  utimesSync(bookmarksFile, new Date('2025-02-01T00:00:00Z'), new Date('2025-02-01T00:00:00Z'));
  // Bookmarks.plist is read beside the History.db a run reads.
  const input = join(dir, 'History.db');
  const extractor = new SafariBookmarksExtractor({ input, account, ...config });
  try {
    await extractor.setup();
    return await read(extractor);
  } finally {
    await extractor.teardown();
  }
}
const bookmarks = (t, config = {}) =>
  withBookmarks(t, config, extractor => Array.fromAsync(extractor.extract()));
const surveyBookmarks = (t, config = {}, options = {}) =>
  withBookmarks(t, config, extractor => extractor.survey(options));

test('bookmarks are dated when Safari added them, newest first', async t => {
  const rows = await bookmarks(t);
  assert.deepEqual(
    rows.map(r => [r.data.id, r.data.addedAt, r.data.folders.map(f => f.name)]),
    [
      ['F-1', '2025-01-01T03:00:00.000Z', ['Favorites']],
      ['R-1', '2025-01-01T02:00:00.000Z', ['Reading List']],
      ['B-2', '2025-01-01T01:00:00.000Z', ['Favorites', 'Design']],
      ['B-3', '2024-12-31T23:00:00.000Z', []],
      // Keyed by its ID on this Mac, as it doesn't sync.
      ['LOCAL-UUID', '2024-12-31T22:00:00.000Z', []],
      // F-2, which Safari didn't date, is left out.
    ]
  );

  const since = new Date('2025-01-01T01:30:00Z');
  assert.deepEqual(
    (await bookmarks(t, { since })).map(r => r.data.id),
    ['F-1', 'R-1']
  );
});

test('a survey counts the bookmarks a run reads, and when', async t => {
  const rows = await bookmarks(t);
  const times = rows.map(r => new Date(r.data.addedAt));
  const survey = await surveyBookmarks(t, {}, { byMonth: true });
  const months = {};
  for (const time of times) months[monthKey(time)] = (months[monthKey(time)] ?? 0) + 1;
  assert.deepEqual(survey, {
    bookmarks: { count: rows.length, earliest: times.at(-1), latest: times[0], byMonth: months },
  });
  // By the run's bounds, but not its limit.
  const since = new Date('2025-01-01T01:30:00Z');
  assert.equal((await surveyBookmarks(t, { since, limit: 1 })).bookmarks.count, 2);
});

test('a History.db with no Bookmarks.plist beside it has no bookmarks', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'safari-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'History.db');
  const extractor = new SafariBookmarksExtractor({ input, account });
  await extractor.setup();
  assert.deepEqual(await Array.fromAsync(extractor.extract()), []);
  assert.deepEqual(await extractor.survey(), { bookmarks: { count: 0 } });

  // One named that isn't there is an error.
  const bookmarksFile = join(dir, 'Bookmarks.plist');
  await assert.rejects(new SafariBookmarksExtractor({ bookmarksFile, account }).setup(), {
    message: 'No bookmarks file found',
  });
});

test('a bookmark is a BookmarkAction whose target is its folder', async t => {
  const rows = await bookmarks(t);
  const transformer = new SafariTransformer();
  const [action] = await transformer.performTransform(rows.find(r => r.data.id === 'B-2'));
  const favorites = {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'safari',
    sourceId: 'Favorites Bar',
    name: 'Favorites',
    '@asserts': ['*'],
  };
  assert.deepEqual(action.data, {
    '@type': 'BookmarkAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'safari',
    sourceId: 'B-2',
    timestamp: new Date('2025-01-01T01:00:00Z'),
    agent: {
      '@type': 'Person',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'icloud',
      sourceId: '1234567890',
      handle: 'you@example.com',
      sameAs: ['@me'],
      '@asserts': ['*'],
    },
    object: {
      '@type': 'Entity',
      '@key': ['url'],
      url: 'https://example.com/design',
      name: 'Design',
      '@asserts': ['*'],
    },
    target: {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'safari',
      sourceId: 'D-1',
      name: 'Design',
      isPartOf: [favorites],
      '@asserts': ['*'],
    },
    // Bookmarks are as of when the file last changed.
    '@assertedAt': '2025-02-01T00:00:00.000Z',
    '@asserts': ['*'],
  });

  // Without a folder, there's no target; without a title, the URL names the page.
  const [loose] = await transformer.performTransform(rows.find(r => r.data.id === 'B-3'));
  assert.equal(loose.data.target, undefined);
  assert.equal(loose.data.object.name, 'https://example.com/three');
});
