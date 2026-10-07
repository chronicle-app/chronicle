import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { ChromeExtractor, ChromeTransformer } from '../dist/index.js';
import { DAY_MS, JAN_1, fixture } from './fixture.test-helper.js';

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
  // SHAPES.md shows the full shape; these are the values it can't show.
  assert.deepEqual(first.timestamp, new Date('2025-01-01T00:00:01Z'));
  // The profile's own account, not another one signed in on the web.
  assert.equal(first.agent.sourceId, 'gaia-1');
  assert.equal(first.agent.sameAs[0].handle, 'you@example.com');
  // Recorded here before the newer sync client id was added.
  assert.equal(first.instrument.sourceId, 'mac-old');
  assert.equal(first.object.name, 'Page A');

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
