import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { ChromeExtractor, ChromeTransformer } from '../dist/index.js';
import { ACCOUNTS, DAY_MS, JAN_1, fixture } from './fixture.test-helper.js';

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
  // Redirect hop 2, subframe 4, chrome:// page 5, imported visit 6, the
  // keyword visit 9 generated beside visit 8, and file 13 are skipped.
  assert.deepEqual(
    records.map(r => r.data.visit_id),
    VISITS
  );

  const actions = await transform(records);
  const [first, redirected, synced] = [1, 3, 7].map(id => actions.get(id)[0]);
  // SHAPES.md shows the full shape; these are the values it can't show.
  assert.deepEqual(first.timestamp, new Date('2025-01-01T00:00:01Z'));
  // A visit is its page and its time: a synced copy keeps both, and two pages
  // opened in the same millisecond stay two.
  assert.deepEqual(first['@key'], ['@type', 'source', 'object.url', 'timestamp']);
  // The profile's own account, not another one signed in on the web: you by
  // its address, lowercased as mail keys it, the Google account at that address.
  assert.deepEqual(first.agent, {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'handle'],
    source: 'email',
    handle: 'you@example.com',
    name: 'Test You',
    sameAs: [
      {
        '@type': 'Agent',
        '@key': ['@type', 'source', 'handle'],
        source: 'google-account',
        handle: 'you@example.com',
      },
      '@me',
    ],
  });
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
      // Chrome has only a referrer URL, which browsers cut to a site's home page.
      [1, undefined],
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
  // The step happened as the page was viewed, by the same viewer, and is
  // keyed as the visit is: by the page landed on and the time.
  const [view, navigate] = actions.get(3);
  assert.deepEqual(navigate.timestamp, view.timestamp);
  assert.deepEqual(navigate.agent, view.agent);
  assert.deepEqual(navigate['@key'], ['@type', 'source', 'target.url', 'timestamp']);
  assert.equal(navigate.target.url, view.object.url);

  // A History file from before 2022 keeps only the page before in the same tab.
  const legacy = await transform(await extract({ input: fixture(t, { legacy: true }).input }));
  assert.deepEqual(step(legacy.get(3)), [A, B, C]);
  assert.equal(legacy.get(7).length, 1);
  assert.equal(legacy.get(1).length, 1);
});

test('the agent is the account signed in now, else the last that synced, else none', async t => {
  // Every view and step has the same agent, or none.
  const agentOf = async prefs => {
    const { input } = fixture(t, { prefs });
    const actions = [...(await transform(await extract({ input }))).values()].flat();
    assert.ok(actions.length > VISITS.length);
    assert.equal(new Set(actions.map(action => JSON.stringify(action.agent))).size, 1);
    return actions[0].agent;
  };
  const lastSynced = { google: { services: { last_gaia_id: 'gaia-1' } } };
  // Signed in to another account now, without sync.
  const now = await agentOf({ ...lastSynced, sync: { gaia_id: 'gaia-2' }, account_info: ACCOUNTS });
  assert.equal(now.handle, 'other@example.com');
  // Signed out: Chrome keeps the last account that synced.
  const last = await agentOf({ ...lastSynced, account_info: ACCOUNTS });
  assert.equal(last.handle, 'you@example.com');
  // Never signed in, an account with no address, or no Preferences at all.
  for (const prefs of [{ account_info: [] }, { sync: { gaia_id: 'gaia-3' } }, null]) {
    assert.equal(await agentOf(prefs), undefined);
  }
});

test('reads the named profile from a copy, even while Chrome holds the lock', async t => {
  const { userData, input } = fixture(t, { profile: 'Profile 1' });
  class FixtureChrome extends ChromeExtractor {
    static userDataDirs = { [process.platform]: () => userData };
  }
  const before = readFileSync(input);

  // Chrome keeps History in exclusive locking mode while it runs.
  const chromeRunning = new DatabaseSync(input);
  chromeRunning.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
  const extractor = new FixtureChrome({ profile: 'Profile 1' });
  let copy;
  try {
    await extractor.setup();
    copy = extractor.copyDir;
    assert.ok(copy && existsSync(copy));
    const records = await Array.fromAsync(extractor.extract());
    assert.deepEqual(
      records.map(r => r.data.visit_id),
      VISITS
    );
    assert.equal(records[0].context.account.email, 'you@example.com');
  } finally {
    await extractor.teardown();
    chromeRunning.exec('ROLLBACK');
    chromeRunning.close();
  }
  assert.equal(existsSync(copy), false);
  assert.deepEqual(readFileSync(input), before);
});

test('a copy that catches Chrome saving is taken again, then the run says to retry', async t => {
  const { input } = fixture(t);
  class Saving extends ChromeExtractor {
    static copyRetryMs = 0;
  }
  // Between saves, Chrome's open transaction fills the journal, not the file.
  const journal = `${input}-journal`;
  writeFileSync(journal, 'open transaction');
  const later = new Date(Date.now() + 60_000);
  utimesSync(journal, later, later);
  assert.deepEqual(
    (await extract({ input, limit: 1 }, Saving)).map(r => r.data.visit_id),
    [12]
  );

  // Saving: the file is written after the journal, until the journal empties.
  const latest = new Date(Date.now() + 120_000);
  utimesSync(input, latest, latest);
  const extractor = new Saving({ input });
  await assert.rejects(extractor.setup(), error => {
    assert.equal(error.code, 'input-busy');
    assert.equal(error.exitCode, 5);
    assert.match(error.hint, /`chronicle extract chrome`/);
    return true;
  });
  // Nothing is left behind.
  assert.equal(extractor.copyDir, null);
});
