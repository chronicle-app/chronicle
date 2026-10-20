import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplePodcastsExtractor, ApplePodcastsTransformer } from '../dist/index.js';
import { account, writeApplePodcastsFixture } from './fixture.test-helper.js';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-podcasts-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function extract(t, config = {}) {
  const input = writeApplePodcastsFixture(tempDir(t));
  const extractor = new ApplePodcastsExtractor({ input, account, limit: 0, ...config });
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  try {
    await extractor.setup();
    return {
      records: await Array.fromAsync(extractor.extract()),
      count: await extractor.determineCount(),
      events,
    };
  } finally {
    await extractor.teardown();
  }
}

// Each run is a snapshot, so every node is asserted complete as of the run.
// Leave those markers out to compare what the nodes say.
function content(node) {
  if (Array.isArray(node)) return node.map(item => content(item));
  if (node === null || typeof node !== 'object' || node instanceof Date) return node;
  const { '@asserts': _asserts, '@assertedAt': _at, ...rest } = node;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, content(v)]));
}

async function actionsOf(records) {
  const transformer = new ApplePodcastsTransformer();
  const out = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) out.push(content(node.data));
  }
  return out;
}

const key = ['@type', 'source', 'sourceId'];
const me = {
  '@type': 'Person',
  source: 'icloud',
  sourceId: '123',
  handle: 'you@example.com',
  '@key': key,
  sameAs: ['@me'],
};
// The feed's author is an Agent named as the feed names it. The show's
// publisher is its channel, keyed by the channel's catalog ID.
const author = name => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'name'],
  source: 'apple-podcasts',
  name,
});
const channel = {
  '@type': 'Organization',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'apple-podcasts',
  sourceId: '3001',
  name: 'Example Network',
};
const image = url => ({ '@type': 'ImageObject', '@key': ['url'], url });
// Shows and episodes are keyed by Apple's catalog ID.
const followedShow = {
  '@type': 'PodcastSeries',
  '@key': key,
  source: 'apple-podcasts',
  sourceId: '1001',
  name: 'Example Conversations',
  description: 'Long conversations.',
  webFeed: 'https://example.com/feed.xml',
  genre: ['Society & Culture'],
  emblem: image('https://example.com/show.jpg'),
  author: [author('Pat Example')],
  publisher: [channel],
};
const unfollowedShow = {
  '@type': 'PodcastSeries',
  '@key': key,
  source: 'apple-podcasts',
  sourceId: '1002',
  name: 'Example Stories',
  webFeed: 'https://example.org/feed.xml',
};
const finishedEpisode = {
  '@type': 'PodcastEpisode',
  '@key': key,
  source: 'apple-podcasts',
  sourceId: '2001',
  name: 'A Finished Episode',
  description: 'A guest on [their new book](https://example.com/book).',
  url: 'https://example.com/episodes/1',
  duration: 'PT3121S',
  emblem: image('https://example.com/art/600x600bb.jpg'),
  contains: [
    {
      '@type': 'AudioObject',
      '@key': ['url'],
      url: 'https://example.com/audio/finished.mp3?dest=1',
    },
  ],
  transcript:
    "SPEAKER_1: Welcome back, it's Q&A time.\n\nSPEAKER_2: Thanks for having me. Glad to be here.",
  series: [followedShow],
  author: [author('Sam Producer, Pat Example')],
};

test('played and saved episodes become listens, completions, and bookmarks, and followed shows become follows', async t => {
  const { records, count, events } = await extract(t);
  const actions = await actionsOf(records);

  // Episodes come out by when they were last listened to, newest first, then
  // the followed shows. The episode played for five seconds is left out, and
  // so are the show and the episode that aren't in Apple's catalog.
  assert.deepEqual(
    actions.map(action => [action['@type'], action.object.name, action.timestamp.toISOString()]),
    [
      ['ListenAction', 'An Episode in Progress', '2025-01-01T02:00:00.000Z'],
      // Marked as played with no last-played date: dated when it was marked.
      ['ListenAction', 'A Trailer', '2025-01-01T01:30:00.000Z'],
      ['CompleteAction', 'A Trailer', '2025-01-01T01:30:00.000Z'],
      // Dated when it was last played, not when the library-wide update synced
      // it again.
      ['ListenAction', 'A Finished Episode', '2025-01-01T00:50:00.000Z'],
      ['CompleteAction', 'A Finished Episode', '2025-01-01T00:50:00.000Z'],
      // Saved a day before it was played.
      ['BookmarkAction', 'A Finished Episode', '2024-12-31T00:00:00.000Z'],
      ['BookmarkAction', 'A Saved Episode', '2025-01-01T00:10:00.000Z'],
      // No last-played date: dated when its playback position last synced, not
      // when the library-wide update changed its play state.
      ['ListenAction', 'An Older Episode', '2024-12-22T00:00:00.000Z'],
      ['CompleteAction', 'An Older Episode', '2024-12-22T00:00:00.000Z'],
      // Followed 30 days before.
      ['FollowAction', 'Example Conversations', '2024-12-02T00:00:00.000Z'],
    ]
  );
  assert.equal(count, 6);

  // Each action is keyed by Apple's catalog ID for its episode or show, which
  // is the same on each device.
  assert.deepEqual(
    [...new Set(actions.map(action => action.sourceId))],
    ['2002', '2005', '2001', '2003', '2006', '1001']
  );

  // The episode carries its show, its author, its audio file, its artwork, its
  // description as Markdown, and its transcript, a paragraph for each speaker's
  // turn, starting with the speaker's label. The show carries its publisher.
  assert.deepEqual(actions[3], {
    '@type': 'ListenAction',
    '@key': key,
    source: 'apple-podcasts',
    sourceId: '2001',
    timestamp: new Date('2025-01-01T00:50:00.000Z'),
    agent: me,
    object: finishedEpisode,
  });

  // An episode whose transcript hasn't been downloaded has none. One whose
  // transcript doesn't read has none either, and the run says so. It says
  // what it left out for not being in the catalog, too.
  const episode = name => actions.find(action => action.object.name === name).object;
  assert.equal(episode('An Episode in Progress').transcript, undefined);
  assert.equal(episode('A Saved Episode').transcript, undefined);
  const hints = events.filter(event => event.kind === 'hint');
  assert.deepEqual(
    hints.map(hint => hint.message),
    [
      '1 transcript couldn’t be read, so its episode has none',
      '1 episode and 1 followed show were left out, as they aren’t in Apple’s catalog',
    ]
  );
  assert.match(hints[0].hint.action, /`chronicle extract apple-podcasts`/);

  // A show reached only through an episode is keyed the same way.
  assert.deepEqual(episode('An Older Episode').series, [unfollowedShow]);
  assert.deepEqual(actions.at(-1).object, followedShow);
});

const ids = records =>
  records.map(record => [
    record.extraction.recordType,
    record.data.episodeTitle ?? record.data.podcastTitle,
  ]);

test('extraction honours the time range and counts what it extracts', async t => {
  // Both bounds are inclusive, against when each episode was last listened to.
  // The finished episode is in, though a feed refresh after the range changed
  // its play state; the older episode is out, though the library-wide update
  // in the range changed its. The episode that isn't in the catalog is out too.
  // Followed shows aren't bounded.
  const listened = await extract(t, {
    since: new Date('2025-01-01T00:50:00Z'),
    until: new Date('2025-01-01T01:30:00Z'),
  });
  assert.deepEqual(ids(listened.records), [
    ['listens', 'A Trailer'],
    ['listens', 'A Finished Episode'],
    ['subscriptions', 'Example Conversations'],
  ]);
  assert.equal(listened.count, 3);

  // A saved episode is in when it was saved in the range.
  const saved = await extract(t, {
    since: new Date('2024-12-31T00:00:00Z'),
    until: new Date('2024-12-31T00:00:00Z'),
  });
  assert.deepEqual(ids(saved.records), [
    ['listens', 'A Finished Episode'],
    ['subscriptions', 'Example Conversations'],
  ]);
  assert.equal(saved.count, 2);
});

test('the limit counts followed shows with the episodes', async t => {
  // The five extracted episodes come first, so a limit of five leaves no room
  // for the followed show.
  const { records } = await extract(t, { limit: 5 });
  assert.deepEqual(
    ids(records).map(([type]) => type),
    ['listens', 'listens', 'listens', 'listens', 'listens']
  );
  const all = await extract(t, { limit: 6 });
  assert.equal(ids(all.records).at(-1)[0], 'subscriptions');
});

test('without an Apple Account, extraction stops and says to sign in', async t => {
  await assert.rejects(extract(t, { account: null }), error => {
    assert.equal(error.code, 'auth-required');
    assert.equal(error.exitCode, 3);
    assert.match(error.hint, /`chronicle extract apple-podcasts`/);
    return true;
  });
});
