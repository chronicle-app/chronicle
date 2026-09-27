import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiAuthError } from '@chronicle.app/etl';
import {
  YouTubeLikesExtractor,
  YouTubePlaylistsExtractor,
  YouTubeSubscriptionsExtractor,
  YouTubeTakeoutExtractor,
  YouTubeUploadsExtractor,
} from '../dist/index.js';
import { parseActivityDate } from '../dist/takeout/parseActivityHtml.js';
import {
  ARCHIVE_TIME,
  CHANNEL_ID,
  FAKE_TOKEN,
  SELF_ID,
  UPLOADER_ID,
  fakeYouTubeApi,
  writeTakeout,
} from './fixture.test-helper.js';

// Every extractor gets an explicit access token, so no test reads stored
// credentials, and the fake API on 127.0.0.1 stands in for Google.
async function run(Extractor, config = {}) {
  const extractor = new Extractor({ accessToken: FAKE_TOKEN, quiet: true, ...config });
  await extractor.setup();
  const rows = await Array.fromAsync(extractor.extract());
  const transformer = extractor.instantiateDefaultTransformer();
  const nodes = [];
  for (const row of rows) {
    const [node] = await transformer.performTransform(row);
    nodes.push(node.data);
  }
  return { extractor, rows, nodes };
}

function takeout(t, options) {
  const dir = mkdtempSync(join(tmpdir(), 'youtube-takeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return writeTakeout(dir, options);
}

/** Mark a node and its nested typed nodes complete, as snapshot payloads are. */
function complete(node) {
  if (Array.isArray(node)) return node.map(n => complete(n));
  if (node === null || typeof node !== 'object' || node instanceof Date) return node;
  const out = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, complete(v)]));
  return node['@type'] ? { ...out, '@asserts': ['*'] } : out;
}

const image = url => ({ '@type': 'ImageObject', '@key': ['url'], url });

const channel = (handle, extra = {}) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source: 'youtube',
  handle,
  url: `https://www.youtube.com/channel/${handle}`,
  ...extra,
});

const bareVideo = (sourceId, extra = {}) => ({
  '@type': 'VideoObject',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'youtube',
  sourceId,
  url: `https://www.youtube.com/watch?v=${sourceId}`,
  ...extra,
});

const apiSelf = channel(SELF_ID, {
  name: 'Test Owner',
  emblem: image('https://i.example/avatar-high.jpg'),
  sameAs: ['@me'],
});

const takeoutSelf = channel(SELF_ID, { name: 'Test Owner', sameAs: ['@me'] });

const realVideo = bareVideo('vidAAAAAAA1', {
  name: 'A Real Video',
  description: 'About A Real Video.',
  duration: 'PT6M2S',
  datePublished: '2020-05-01T00:00:00Z',
  emblem: image('https://i.example/vidAAAAAAA1-maxres.jpg'),
  author: [channel(UPLOADER_ID, { name: 'Uploader' })],
});

const collection = {
  '@type': 'Collection',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'youtube',
  sourceId: 'PLxyz',
  url: 'https://www.youtube.com/playlist?list=PLxyz',
  name: 'Piano takes',
  description: 'Live takes.',
  visibility: 'unlisted',
  emblem: image('https://i.example/playlist-high.jpg'),
};

test('likes become LikeActions by the @me channel, hydrated from videos.list', async t => {
  const requests = await fakeYouTubeApi(t);
  const { extractor, nodes } = await run(YouTubeLikesExtractor);

  // Two pages of the likes playlist, then one videos.list call for all ids.
  assert.deepEqual(
    requests.map(r => [r.path, r.query.pageToken]),
    [
      ['/channels', undefined],
      ['/playlistItems', undefined],
      ['/playlistItems', '2'],
      ['/videos', undefined],
    ]
  );
  assert.equal(requests[3].query.id, 'vidAAAAAAA1,vidAAAAAAA2,vidAAAAAAA3');

  const likeKey = ['@type', 'source', 'agent.handle', 'object.sourceId', 'timestamp'];
  // Timestamps are truncated to the second.
  const likedAt = new Date('2024-11-22T03:14:20Z');
  assert.deepEqual(nodes[0], {
    '@type': 'LikeAction',
    '@key': likeKey,
    source: 'youtube',
    timestamp: likedAt,
    agent: apiSelf,
    object: realVideo,
    '@assertedAt': likedAt,
  });

  // A deleted video keeps only its id and url, never YouTube's placeholder title.
  const deletedAt = new Date('2024-10-01T08:00:00Z');
  assert.deepEqual(nodes[1], {
    '@type': 'LikeAction',
    '@key': likeKey,
    source: 'youtube',
    timestamp: deletedAt,
    agent: apiSelf,
    object: bareVideo('vidAAAAAAA2'),
    '@assertedAt': deletedAt,
  });
  assert.equal(nodes.length, 3);
  assert.equal(await extractor.determineCount(), 3);

  // since is exclusive, and limit keeps the newest.
  const since = new Date('2024-10-01T08:00:00Z');
  const recent = await run(YouTubeLikesExtractor, { since });
  assert.deepEqual(
    recent.rows.map(r => r.data.item.id),
    ['lli-1']
  );
  const limited = await run(YouTubeLikesExtractor, { limit: 2 });
  assert.deepEqual(
    limited.rows.map(r => r.data.item.id),
    ['lli-1', 'lli-2']
  );
});

test('subscriptions, playlists and uploads map to Follow, Create, Add and Publish actions', async t => {
  await fakeYouTubeApi(t);

  // Subscriptions are a snapshot: sighted at read time, subscribe date kept.
  const subs = await run(YouTubeSubscriptionsExtractor);
  assert.deepEqual(subs.nodes, [
    complete({
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: CHANNEL_ID,
      timestamp: new Date('2023-12-06T13:53:59Z'),
      agent: apiSelf,
      object: channel(CHANNEL_ID, {
        name: 'Some Channel',
        description: 'Channel description.',
        emblem: image('https://i.example/channel-high.jpg'),
      }),
      '@assertedAt': subs.rows[0].extraction.assertedAt,
    }),
  ]);
  assert.equal(await subs.extractor.determineCount(), 1);

  const playlists = await run(YouTubePlaylistsExtractor);
  const { assertedAt } = playlists.rows[0].extraction;
  assert.deepEqual(playlists.nodes, [
    complete({
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: 'PLxyz',
      timestamp: new Date('2019-05-24T03:17:07Z'),
      agent: apiSelf,
      result: collection,
      '@assertedAt': assertedAt,
    }),
    complete({
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      source: 'youtube',
      sourceId: 'pli-abc',
      timestamp: new Date('2024-12-01T10:00:00Z'),
      agent: apiSelf,
      object: realVideo,
      target: collection,
      '@assertedAt': assertedAt,
    }),
  ]);
  // One playlist plus its one item.
  assert.equal(await playlists.extractor.determineCount(), 2);

  // The upload's timestamp is its publication; the video carries no datePublished.
  const uploads = await run(YouTubeUploadsExtractor);
  const publishedAt = new Date('2021-06-25T21:41:25Z');
  assert.deepEqual(uploads.nodes, [
    {
      '@type': 'PublishAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: 'vidUPLOAD01',
      timestamp: publishedAt,
      agent: apiSelf,
      object: bareVideo('vidUPLOAD01', {
        name: 'My Upload',
        duration: 'PT6M2S',
        emblem: image('https://i.example/vidUPLOAD01-high.jpg'),
        author: [channel(SELF_ID, { name: 'Test Owner' })],
      }),
      '@assertedAt': publishedAt,
    },
  ]);
});

test('a rejected token fails setup with re-authentication guidance', async t => {
  await fakeYouTubeApi(t);
  const extractor = new YouTubeLikesExtractor({ accessToken: 'stale-token', quiet: true });
  await assert.rejects(
    extractor.setup(),
    error => error instanceof ApiAuthError && error.message.includes('chronicle auth login youtube')
  );
});

test('a Takeout archive maps to the same shapes as the API', async t => {
  const input = takeout(t);
  const { rows, nodes } = await run(YouTubeTakeoutExtractor, { input });

  // Ad impressions, ad clicks and Shorts-tool entries are skipped, as is a
  // playlist file with no matching row in playlists.csv and an unpublished draft.
  assert.deepEqual(
    rows.map(r => r.extraction.recordType),
    [
      'watches',
      'watches',
      'watches',
      'searches',
      'subscriptions',
      'playlists',
      'playlist-items',
      'uploads',
      'comments',
      'comments',
    ]
  );
  // The archive is sighted at its files' modification time.
  assert.equal(rows[0].extraction.assertedAt, ARCHIVE_TIME.toISOString());
  const assertedAt = ARCHIVE_TIME.toISOString();
  const [watch, deletedWatch, musicWatch, search, follow, create, add, publish, comment, plain] =
    nodes;

  // 10:46:36 PM EDT is 02:46:36 UTC the next day; entities are decoded, and the
  // http:// channel link becomes the canonical https url.
  assert.deepEqual(
    watch,
    complete({
      '@type': 'WatchAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.sourceId', 'timestamp'],
      source: 'youtube',
      timestamp: new Date('2026-07-26T02:46:36Z'),
      agent: takeoutSelf,
      object: bareVideo('vidAAAAAAA1', {
        name: "Tom & Jerry '65",
        author: [channel(UPLOADER_ID, { name: 'Uploader' })],
      }),
      '@assertedAt': assertedAt,
    })
  );
  // A deleted video's entry shows its URL as the title; that is not its name.
  assert.deepEqual(deletedWatch.object, complete(bareVideo('vidDELETED1')));
  // A YouTube Music watch gets the canonical www watch url.
  assert.deepEqual(musicWatch.object, complete(bareVideo('vidMUSIC001', { name: 'A Song' })));
  assert.deepEqual(musicWatch.timestamp, new Date('2020-01-02T05:05:00Z'));

  assert.deepEqual(
    search,
    complete({
      '@type': 'FindAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.body', 'timestamp'],
      source: 'youtube',
      timestamp: new Date('2026-07-22T20:56:45Z'),
      agent: takeoutSelf,
      object: {
        '@type': 'Query',
        '@key': ['@type', 'source', 'body'],
        source: 'youtube',
        name: 'cowboy songs',
        body: 'cowboy songs',
      },
      '@assertedAt': assertedAt,
    })
  );

  // Takeout has no subscribe date, so the follow has no timestamp.
  assert.deepEqual(
    follow,
    complete({
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: CHANNEL_ID,
      agent: takeoutSelf,
      object: channel(CHANNEL_ID, { name: 'Some Channel' }),
      '@assertedAt': assertedAt,
    })
  );

  const takeoutCollection = {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'youtube',
    sourceId: 'PLxyz',
    url: 'https://www.youtube.com/playlist?list=PLxyz',
    name: 'Piano takes',
  };
  assert.deepEqual(
    create,
    complete({
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: 'PLxyz',
      timestamp: new Date('2019-05-24T03:17:07Z'),
      agent: takeoutSelf,
      result: { ...takeoutCollection, visibility: 'unlisted' },
      '@assertedAt': assertedAt,
    })
  );
  assert.deepEqual(
    add,
    complete({
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      source: 'youtube',
      timestamp: new Date('2024-12-01T10:00:00Z'),
      agent: takeoutSelf,
      object: bareVideo('vidAAAAAAA1'),
      target: takeoutCollection,
      '@assertedAt': assertedAt,
    })
  );

  assert.deepEqual(
    publish,
    complete({
      '@type': 'PublishAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: 'vidUPLOAD01',
      timestamp: new Date('2021-06-25T21:41:25Z'),
      agent: takeoutSelf,
      object: bareVideo('vidUPLOAD01', {
        name: 'My Upload',
        description: 'Line one\nline two',
        duration: 'PT2M3S',
      }),
      '@assertedAt': assertedAt,
    })
  );

  // Comment text is unwrapped from its JSON; microseconds truncate to the second.
  assert.deepEqual(
    comment,
    complete({
      '@type': 'AnnotateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: 'Ugy5w_comment1',
      timestamp: new Date('2020-04-20T18:52:40Z'),
      agent: takeoutSelf,
      object: bareVideo('vidAAAAAAA1'),
      result: {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'youtube',
        sourceId: 'Ugy5w_comment1',
        body: 'Nailed the hallway scene',
        author: [takeoutSelf],
        about: [bareVideo('vidAAAAAAA1')],
      },
      '@assertedAt': assertedAt,
    })
  );
  assert.equal(plain.result.body, 'plain text');

  // since is inclusive here; limit caps the whole archive.
  const since = new Date('2026-07-22T20:56:45Z');
  const recent = await run(YouTubeTakeoutExtractor, { input, since });
  assert.deepEqual(
    recent.rows.slice(0, 2).map(r => r.extraction.recordType),
    ['watches', 'searches']
  );
  const limited = await run(YouTubeTakeoutExtractor, { input, limit: 2 });
  assert.equal(limited.rows.length, 2);
});

test('Takeout and API playlist memberships share one key', async t => {
  await fakeYouTubeApi(t);
  const api = await run(YouTubePlaylistsExtractor);
  const archive = await run(YouTubeTakeoutExtractor, { input: takeout(t) });
  const apiAdd = api.nodes[1];
  const takeoutAdd = archive.nodes.find(n => n['@type'] === 'AddAction');

  assert.deepEqual(takeoutAdd['@key'], apiAdd['@key']);
  assert.equal(takeoutAdd.object.sourceId, apiAdd.object.sourceId);
  assert.equal(takeoutAdd.target.sourceId, apiAdd.target.sourceId);
  assert.deepEqual(takeoutAdd.timestamp, apiAdd.timestamp);
});

test('without channels/channel.csv the owner is the per-source singleton', async t => {
  const { nodes } = await run(YouTubeTakeoutExtractor, {
    input: takeout(t, { channel: false }),
    limit: 1,
  });
  assert.deepEqual(nodes[0]['@key'], ['@type', 'source', 'object.sourceId', 'timestamp']);
  assert.deepEqual(
    nodes[0].agent,
    complete({ '@type': 'Agent', '@key': ['@type', 'source'], source: 'youtube', sameAs: ['@me'] })
  );
});

test('the Takeout extractor needs --input', async () => {
  const extractor = new YouTubeTakeoutExtractor({ quiet: true });
  await assert.rejects(extractor.setup(), /needs --input/);
});

test('My Activity dates read through the meridiem and reject unknown zones', () => {
  assert.equal(
    parseActivityDate('Jan 2, 2020, 12:05:00 PM EST').toISOString(),
    '2020-01-02T17:05:00.000Z'
  );
  assert.throws(() => parseActivityDate('Jan 2, 2020 at 1:00 PM'), /Unparseable/);
  assert.throws(() => parseActivityDate('Jan 2, 2020, 1:00:00 PM CET'), /Unknown timezone/);
});
