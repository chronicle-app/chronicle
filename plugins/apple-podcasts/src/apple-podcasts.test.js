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
const network = {
  '@type': 'Organization',
  '@key': ['@type', 'source', 'name'],
  source: 'apple-podcasts',
  name: 'Example Network',
};
const image = url => ({ '@type': 'ImageObject', '@key': ['url'], url });
const followedShow = {
  '@type': 'PodcastSeries',
  '@key': key,
  source: 'apple-podcasts',
  sourceId: 'SHOW-FOLLOWED',
  name: 'Example Conversations',
  description: 'Long conversations.',
  webFeed: 'https://example.com/feed.xml',
  genre: ['Society & Culture'],
  emblem: image('https://example.com/show.jpg'),
  publisher: [network],
};
const finishedEpisode = {
  '@type': 'PodcastEpisode',
  '@key': key,
  source: 'apple-podcasts',
  sourceId: 'EP-FINISHED',
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
  transcript: "Welcome back, it's Q&A time.\n\nThanks for having me. Glad to be here.",
  series: [followedShow],
  publisher: [network],
  sameAs: [
    {
      '@type': 'PodcastEpisode',
      '@key': key,
      source: 'apple-podcasts',
      sourceId: '2001',
      name: 'A Finished Episode',
    },
  ],
};

test('played and saved episodes become listens, completions, and bookmarks, and followed shows become follows', async t => {
  const { records, count, events } = await extract(t);
  const actions = await actionsOf(records);

  // Episodes come out by when their play state last changed, newest first, then
  // the followed shows. The episode played for five seconds is left out.
  assert.deepEqual(
    actions.map(action => [action['@type'], action.sourceId, action.timestamp.toISOString()]),
    [
      ['ListenAction', 'EP-IN-PROGRESS', '2025-01-01T02:00:00.000Z'],
      // Marked as played with no last-played date: dated when it was marked.
      ['ListenAction', 'EP-MARKED', '2025-01-01T01:30:00.000Z'],
      ['CompleteAction', 'EP-MARKED', '2025-01-01T01:30:00.000Z'],
      ['ListenAction', 'EP-FINISHED', '2025-01-01T00:50:00.000Z'],
      ['CompleteAction', 'EP-FINISHED', '2025-01-01T00:50:00.000Z'],
      // Saved a day before it was played.
      ['BookmarkAction', 'EP-FINISHED', '2024-12-31T00:00:00.000Z'],
      ['BookmarkAction', 'EP-SAVED', '2025-01-01T00:10:00.000Z'],
      // Followed 30 days before.
      ['FollowAction', 'SHOW-FOLLOWED', '2024-12-02T00:00:00.000Z'],
    ]
  );
  assert.equal(count, 5);

  // The episode carries its show, its audio file, its artwork, Apple's catalog
  // ID, its description as Markdown, and its transcript, a paragraph for each
  // speaker's turn.
  assert.deepEqual(actions[3], {
    '@type': 'ListenAction',
    '@key': key,
    source: 'apple-podcasts',
    sourceId: 'EP-FINISHED',
    timestamp: new Date('2025-01-01T00:50:00.000Z'),
    agent: me,
    object: finishedEpisode,
  });

  // An episode whose transcript hasn't been downloaded has none. One whose
  // transcript doesn't read has none either, and the run says so.
  assert.equal(actions[0].object.transcript, undefined);
  assert.equal(actions.at(-2).object.transcript, undefined);
  const hints = events.filter(event => event.kind === 'hint');
  assert.deepEqual(
    hints.map(hint => hint.message),
    ['1 transcript couldn’t be read, so its episode has none']
  );
  assert.match(hints[0].hint.action, /`chronicle extract apple-podcasts`/);

  // A followed show is linked to Apple's catalog ID for it.
  assert.deepEqual(actions.at(-1).object, {
    ...followedShow,
    sameAs: [
      {
        '@type': 'PodcastSeries',
        '@key': key,
        source: 'apple-podcasts',
        sourceId: '1001',
        name: 'Example Conversations',
      },
    ],
  });
});

test('extraction honours the time range and counts what it extracts', async t => {
  const { records, count } = await extract(t, {
    since: new Date('2025-01-01T00:50:00Z'),
    until: new Date('2025-01-01T01:30:00Z'),
  });
  // Both bounds are inclusive, against when each episode's play state last
  // changed. Followed shows aren't bounded.
  assert.deepEqual(
    records.map(record => [
      record.extraction.recordType,
      record.data.episodeId ?? record.data.podcastId,
    ]),
    [
      ['listens', 'EP-MARKED'],
      ['listens', 'EP-FINISHED'],
      ['subscriptions', 'SHOW-FOLLOWED'],
    ]
  );
  assert.equal(count, 3);
});

test('without an Apple Account, extraction stops and says to sign in', async t => {
  await assert.rejects(extract(t, { account: null }), error => {
    assert.equal(error.code, 'auth-required');
    assert.equal(error.exitCode, 3);
    assert.match(error.hint, /`chronicle extract apple-podcasts`/);
    return true;
  });
});
