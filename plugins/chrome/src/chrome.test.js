import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChromeExtractor, ChromeTransformer } from '../dist/index.js';

// Unix ms for 2025-01-01T00:00:00Z, and Chrome's microseconds since 1601 for it.
const JAN_1 = 1_735_689_600_000;
const chrome = ms => (ms + 11_644_473_600_000) * 1000;
// Days since 1601, as Preferences stores when a sync client id was added.
const day = ms => Math.floor(ms / 86_400_000) + 134_774;
const DAY_MS = 86_400_000;

// visits.transition: core type in the low byte, chain qualifiers above.
const LINK = 0x30_00_00_00; // a link, start and end of its own chain
const REDIRECT_HOP = 0x10_00_00_00; // redirected onward, never landed
const AFTER_SERVER_REDIRECT = -0x60_00_00_00; // chain end + server redirect, as a signed int32
const MANUAL_SUBFRAME = 0x30_00_00_04;
const KEYWORD_GENERATED = 0x30_00_00_0a;

const preferences = {
  google: { services: { last_gaia_id: 'gaia-1' } },
  // Other Google accounts signed in on the web are listed too.
  account_info: [
    { gaia: 'gaia-2', email: 'other@example.com' },
    { gaia: 'gaia-1', email: 'you@example.com' },
  ],
  sync: {
    local_device_guids_with_timestamp: [
      { cache_guid: 'mac-new', timestamp: day(JAN_1 + DAY_MS) },
      { cache_guid: 'mac-old', timestamp: day(JAN_1 - 10 * DAY_MS) },
    ],
  },
};

function fixture(t, { prefs = preferences, profile = 'Default' } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'chrome-fixture-'));
  t.after(() => rmSync(userData, { recursive: true, force: true }));
  const dir = join(userData, profile);
  mkdirSync(dir);
  const input = join(dir, 'History');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR);
    CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
      visit_time INTEGER NOT NULL, transition INTEGER NOT NULL, originator_cache_guid TEXT);
    CREATE INDEX visits_time_index ON visits (visit_time);
    CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
    INSERT INTO urls VALUES (1, 'https://example.com/a', 'Page A'),
      (2, 'https://example.com/b', ''), (3, 'https://example.com/c', 'Page C'),
      (4, 'chrome://settings/', 'Settings'), (5, 'https://search.example/', 'Search');
    INSERT INTO visits VALUES
      (1, 1, ${chrome(JAN_1 + 1000)}, ${LINK}, ''),
      (2, 2, ${chrome(JAN_1 + 2000)}, ${REDIRECT_HOP}, ''),
      (3, 3, ${chrome(JAN_1 + 2000) + 500}, ${AFTER_SERVER_REDIRECT}, ''),
      (4, 1, ${chrome(JAN_1 + 3000)}, ${MANUAL_SUBFRAME}, ''),
      (5, 4, ${chrome(JAN_1 + 4000)}, ${LINK}, ''),
      (6, 2, ${chrome(JAN_1 + 5000)}, ${LINK}, ''),
      (7, 2, ${chrome(JAN_1 + 6000)}, ${LINK}, 'phone-guid'),
      (8, 3, ${chrome(JAN_1 + 2 * DAY_MS)}, ${LINK}, NULL),
      (9, 5, ${chrome(JAN_1 + 2 * DAY_MS) + 20}, ${KEYWORD_GENERATED}, '');
    -- 6 was imported from Safari, 7 synced from another device.
    INSERT INTO visit_source VALUES (6, 5), (7, 0);
  `);
  db.close();
  if (prefs) writeFileSync(join(dir, 'Preferences'), JSON.stringify(prefs));
  return { userData, input };
}

async function extract(config, Extractor = ChromeExtractor) {
  const extractor = new Extractor(config);
  try {
    await extractor.setup();
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

async function views(records) {
  const transformer = new ChromeTransformer();
  return Promise.all(records.map(async r => (await transformer.performTransform(r))[0].data));
}

test('visits become schema-valid ViewActions, newest first', async t => {
  const { input } = fixture(t);
  const records = await extract({ input });
  // Redirect hop 2, subframe 4, chrome:// page 5, imported visit 6 and the
  // keyword visit 9 generated beside visit 8 are skipped.
  assert.deepEqual(
    records.map(r => r.data.visit_id),
    [8, 7, 3, 1]
  );

  const [latest, synced, redirected, first] = await views(records);
  assert.deepEqual(first, {
    '@type': 'ViewAction',
    timestamp: new Date('2025-01-01T00:00:01Z'),
    '@assertedAt': new Date('2025-01-01T00:00:01Z'),
    '@key': ['@type', 'source', 'timestamp'],
    source: 'chrome',
    agent: {
      '@type': 'Person',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'google-account',
      sourceId: 'gaia-1',
      sameAs: [
        {
          '@type': 'Person',
          '@key': ['@type', 'source', 'handle'],
          source: 'email',
          handle: 'you@example.com',
        },
        '@me',
      ],
    },
    // Recorded here before the newer sync client id was added.
    instrument: {
      '@type': 'SoftwareApplication',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'chrome',
      sourceId: 'mac-old',
      name: 'Chrome',
    },
    object: {
      '@type': 'Entity',
      '@key': ['url'],
      url: 'https://example.com/a',
      name: 'Page A',
    },
  });

  // Sub-millisecond Chrome times truncate to the millisecond.
  assert.deepEqual(redirected.timestamp, new Date('2025-01-01T00:00:02Z'));
  // A synced visit names the install that recorded it; an untitled page its URL.
  assert.equal(synced.instrument.sourceId, 'phone-guid');
  assert.equal(synced.object.name, 'https://example.com/b');
  assert.equal(latest.instrument.sourceId, 'mac-new');

  // since/until are converted to Chrome's visit times.
  const since = new Date(JAN_1 + 2500);
  const until = new Date(JAN_1 + DAY_MS);
  assert.deepEqual(
    (await extract({ input, since, until })).map(r => r.data.visit_id),
    [7]
  );
  const counter = new ChromeExtractor({ input, since });
  try {
    await counter.setup();
    assert.equal(await counter.determineCount(), 2);
  } finally {
    await counter.teardown();
  }
});

test('a signed-out profile without sync has no agent or instrument', async t => {
  for (const prefs of [{ account_info: [] }, null]) {
    const { input } = fixture(t, { prefs });
    const [view] = await views(await extract({ input, limit: 1 }));
    assert.equal('agent' in view, false);
    assert.equal('instrument' in view, false);
  }
});

test('reads the named profile, and a clone while Chrome holds the lock', async t => {
  const { userData, input } = fixture(t, { profile: 'Profile 1' });
  class FixtureChrome extends ChromeExtractor {
    static userDataDirs = { [process.platform]: () => userData };
  }
  const before = readFileSync(input);

  // Chrome keeps History in exclusive locking mode while it runs.
  const chromeRunning = new DatabaseSync(input);
  chromeRunning.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
  const extractor = new FixtureChrome({ profile: 'Profile 1' });
  let clone;
  try {
    await extractor.setup();
    clone = extractor.cloneDir;
    assert.ok(clone && existsSync(clone));
    const records = await Array.fromAsync(extractor.extract());
    assert.deepEqual(
      records.map(r => r.data.visit_id),
      [8, 7, 3, 1]
    );
    assert.equal(records[0].context.account.gaiaId, 'gaia-1');
  } finally {
    await extractor.teardown();
    chromeRunning.exec('ROLLBACK');
    chromeRunning.close();
  }
  assert.equal(existsSync(clone), false);
  assert.deepEqual(readFileSync(input), before);
});
