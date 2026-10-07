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

/** Each record's actions, by visit id: its ViewAction, then any NavigateAction. */
async function transform(records) {
  const transformer = new ChromeTransformer();
  const outputs = await Promise.all(records.map(r => transformer.performTransform(r)));
  return new Map(records.map((r, i) => [r.data.visit_id, outputs[i].map(o => o.data)]));
}

const VISITS = [12, 11, 10, 8, 7, 3, 1];
const A = 'https://example.com/a';
const B = 'https://example.com/b';
const C = 'https://example.com/c';

/** A visit's step: the page it came from, the link followed on it, and where it landed. */
const step = ([, navigate]) =>
  navigate && [navigate.object.url, navigate.object.references?.[0].url, navigate.target.url];

test('visits become schema-valid ViewActions, newest first', async t => {
  const { input } = fixture(t);
  const records = await extract({ input });
  // Redirect hop 2, subframe 4, chrome:// page 5, imported visit 6 and the
  // keyword visit 9 generated beside visit 8 are skipped.
  assert.deepEqual(
    records.map(r => r.data.visit_id),
    VISITS
  );

  const actions = await transform(records);
  const [first, redirected, synced] = [1, 3, 7].map(id => actions.get(id)[0]);
  // SHAPES.md shows the full shape; these are the values it can't show.
  assert.deepEqual(first.timestamp, new Date('2025-01-01T00:00:01Z'));
  // The profile's own account, not another one signed in on the web.
  assert.equal(first.agent.sourceId, 'gaia-1');
  assert.equal(first.agent.sameAs[0].handle, 'you@example.com');
  assert.equal(first.object.name, 'Page A');

  // Sub-millisecond Chrome times truncate to the millisecond.
  assert.deepEqual(redirected.timestamp, new Date('2025-01-01T00:00:02Z'));
  // An untitled page is named by its URL.
  assert.equal(synced.object.name, 'https://example.com/b');

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
    assert.equal(await counter.determineCount(), 5);
  } finally {
    await counter.teardown();
  }
});

test('a link or form followed from a page is a NavigateAction beside the view', async t => {
  const { input } = fixture(t);
  const actions = await transform(await extract({ input }));
  assert.deepEqual(
    new Map([...actions].map(([id, list]) => [id, step(list)])),
    new Map([
      // From a page Chrome has only as a referrer URL.
      [1, ['https://elsewhere.example/', A, A]],
      // From A, through a link to B that redirected to C.
      [3, [A, B, C]],
      // In a new tab opened from C.
      [7, [C, B, B]],
      // From a browser page.
      [8, undefined],
      // A form on C, the page before it in its tab, not the one that opened the
      // tab. A form's address is not a link on the page.
      [10, [C, undefined, B]],
      // Back, and from the same page.
      [11, undefined],
      [12, undefined],
    ])
  );
  // The step happened as the page was viewed, by the same viewer.
  const [view, navigate] = actions.get(3);
  assert.deepEqual(navigate.timestamp, view.timestamp);
  assert.deepEqual(navigate.agent, view.agent);

  // A History file from before 2022 keeps only the page before in the same tab.
  const legacy = await transform(await extract({ input: fixture(t, { legacy: true }).input }));
  assert.deepEqual(step(legacy.get(3)), [A, B, C]);
  assert.equal(legacy.get(7).length, 1);
  assert.equal(legacy.get(1).length, 1);
});

test('a signed-out profile has no agent', async t => {
  for (const prefs of [{ account_info: [] }, null]) {
    const { input } = fixture(t, { prefs });
    const actions = [...(await transform(await extract({ input }))).values()].flat();
    assert.ok(actions.length > VISITS.length);
    assert.ok(actions.every(action => !('agent' in action)));
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
      VISITS
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
