/* eslint-disable camelcase -- Fixtures use Are.na API field names. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Credentials are read from and written to a throwaway config directory, never
// the host's. Set before the credential store is first used.
const configDir = mkdtempSync(join(tmpdir(), 'arena-config-'));
process.env.CHRONICLE_CONFIG_DIR = configDir;
process.on('exit', () => rmSync(configDir, { recursive: true, force: true }));

const { CredentialManager } = await import('@chronicle.app/auth');
const { ArenaBookmarksExtractor, ArenaFollowingExtractor, ArenaTransformer } =
  await import('../dist/index.js');
const { fakeArena } = await import('./fixture.test-helper.js');

const KEY = ['@type', 'source', 'sourceId'];

async function run(Extractor, config) {
  const extractor = new Extractor({ accessToken: 'fake-token', ...config });
  await extractor.setup();
  const rows = await Array.fromAsync(extractor.extract());
  const transformer = new ArenaTransformer();
  const payloads = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop -- Transform in record order.
    const nodes = await transformer.performTransform(row);
    payloads.push(...nodes.map(n => n.data));
  }
  return { rows, payloads, assertedAt: rows[0]?.extraction.assertedAt };
}

const pat = {
  '@type': 'Agent',
  '@key': KEY,
  source: 'arena',
  sourceId: '1',
  handle: 'pat-example',
  name: 'Pat Example',
  url: 'https://www.are.na/pat-example',
  emblem: {
    '@type': 'ImageObject',
    '@key': ['url'],
    url: 'https://example.com/avatars/pat.png',
    '@asserts': ['*'],
  },
  sameAs: ['@me'],
  '@asserts': ['*'],
};

const alex = {
  '@type': 'Agent',
  '@key': KEY,
  source: 'arena',
  sourceId: '2',
  handle: 'alex-example',
  name: 'Alex Example',
  url: 'https://www.are.na/alex-example',
  '@asserts': ['*'],
};

const moodBoard = {
  '@type': 'Collection',
  '@key': KEY,
  source: 'arena',
  sourceId: '10',
  name: 'Mood board',
  url: 'https://www.are.na/pat-example/mood-board',
  description: 'Things I like',
  visibility: 'public',
  '@asserts': ['description', '*'],
};

const sharedReading = {
  '@type': 'Collection',
  '@key': KEY,
  source: 'arena',
  sourceId: '11',
  name: 'Shared reading',
  url: 'https://www.are.na/alex-example/shared-reading',
  visibility: 'public',
  '@asserts': ['description', '*'],
};

const photoPost = {
  '@type': 'Post',
  '@key': KEY,
  source: 'arena',
  sourceId: '20',
  url: 'https://www.are.na/block/20',
  author: [pat],
  name: 'Synthetic photo',
  body: 'A photo',
  references: [
    { '@type': 'Entity', '@key': ['url'], url: 'https://example.com/photo', '@asserts': ['*'] },
  ],
  contains: [
    {
      '@type': 'ImageObject',
      '@key': ['url'],
      url: 'https://example.com/images/20.jpg',
      width: 800,
      height: 600,
      caption: 'A synthetic photo',
      '@asserts': ['*'],
    },
  ],
  '@asserts': ['name', 'body', 'references', 'contains', '*'],
};

test('channels, connections, blocks and comments become schema-valid actions', async t => {
  const requests = fakeArena(t);
  const { rows, payloads, assertedAt } = await run(ArenaBookmarksExtractor);

  // Channels are walked most recently updated first, across both pages.
  assert.deepEqual(
    rows.map(r => r.extraction.recordType),
    ['channels', 'connections', 'blocks', 'connections', 'comments']
  );
  assert.deepEqual(
    requests.map(r => [r.url, r.params?.page]),
    [
      ['/me', undefined],
      ['/users/1/contents', 1],
      ['/users/1/contents', 2],
      ['/channels/10/contents', 1],
      ['/channels/11/contents', 1],
      ['/blocks/21/comments', 1],
    ]
  );
  assert.ok(requests.every(r => r.authorization === 'Bearer fake-token'));
  assert.deepEqual(requests[1].params, { type: 'Channel', page: 1, per: 50 });

  const [channelCreate, blockBookmark, blockCreate, channelBookmark, commentCreate] = payloads;
  assert.deepEqual(channelCreate, {
    '@type': 'CreateAction',
    '@key': KEY,
    timestamp: new Date('2025-01-01T00:00:00Z'),
    source: 'arena',
    sourceId: 'channel-10',
    agent: pat,
    object: moodBoard,
    '@assertedAt': assertedAt,
    '@asserts': ['*'],
  });
  assert.deepEqual(blockBookmark, {
    '@type': 'BookmarkAction',
    '@key': KEY,
    timestamp: new Date('2025-01-10T00:00:00Z'),
    source: 'arena',
    sourceId: '100',
    agent: pat,
    object: photoPost,
    target: moodBoard,
    '@assertedAt': assertedAt,
    '@asserts': ['*'],
  });
  assert.deepEqual(blockCreate.object, photoPost);
  assert.equal(blockCreate.sourceId, 'block-20');
  // A `closed` channel is publicly viewable, so it maps to `public`.
  assert.deepEqual(channelBookmark.object, sharedReading);
  assert.deepEqual(commentCreate, {
    '@type': 'CreateAction',
    '@key': KEY,
    timestamp: new Date('2025-01-04T00:00:00Z'),
    source: 'arena',
    sourceId: 'comment-30',
    agent: pat,
    object: {
      '@type': 'Comment',
      '@key': KEY,
      source: 'arena',
      sourceId: '30',
      author: [pat],
      about: [
        {
          '@type': 'Post',
          '@key': KEY,
          source: 'arena',
          sourceId: '21',
          url: 'https://www.are.na/block/21',
          author: [alex],
          body: 'Hello from Alex',
          '@asserts': ['name', 'body', 'references', 'contains', '*'],
        },
      ],
      body: 'Nice',
      '@asserts': ['*'],
    },
    '@assertedAt': assertedAt,
    '@asserts': ['*'],
  });
});

test('--since skips earlier activity and stops at channels untouched since', async t => {
  const requests = fakeArena(t);
  const recent = await run(ArenaBookmarksExtractor, { since: new Date('2025-01-06T00:00:00Z') });
  // Only the block's connection and creation come after the cutoff; the channel,
  // the nested-channel connection and the comment predate it.
  assert.deepEqual(
    recent.rows.map(r => [r.extraction.recordType, r.data.item?.id ?? r.data.id]),
    [
      ['connections', 20],
      ['blocks', 20],
    ]
  );

  requests.length = 0;
  const later = await run(ArenaBookmarksExtractor, { since: new Date('2025-02-15T00:00:00Z') });
  assert.deepEqual(later.rows, []);
  // The second channel was last updated before the cutoff, so it isn't read.
  assert.ok(!requests.some(r => r.url === '/channels/11/contents'));
});

test('follows become FollowActions of users, channels and groups', async t => {
  fakeArena(t);
  const { payloads, assertedAt } = await run(ArenaFollowingExtractor);
  const follow = object => ({
    '@type': 'FollowAction',
    '@key': ['@type', 'source', 'agent', 'object'],
    source: 'arena',
    agent: pat,
    object,
    '@assertedAt': assertedAt,
    '@asserts': ['*'],
  });
  assert.deepEqual(payloads, [
    follow(alex),
    follow(sharedReading),
    follow({
      '@type': 'Agent',
      '@key': KEY,
      source: 'arena',
      sourceId: '40',
      handle: 'example-group',
      name: 'Example Group',
      url: 'https://www.are.na/example-group',
      '@asserts': ['*'],
    }),
  ]);
});

test('--limit caps the follows, not the one record that carries them', async t => {
  fakeArena(t);
  const limited = await run(ArenaFollowingExtractor, { limit: 2 });
  assert.deepEqual(
    limited.payloads.map(p => p.object.sourceId),
    [alex.sourceId, sharedReading.sourceId]
  );
  // 0 means no limit.
  const all = await run(ArenaFollowingExtractor, { limit: 0 });
  assert.equal(all.payloads.length, 3);
});

test('a selected user is not tagged as the token owner', async t => {
  const requests = fakeArena(t);
  const { payloads } = await run(ArenaFollowingExtractor, { userId: 2 });
  assert.ok(requests.some(r => r.url === '/users/2/following'));
  assert.deepEqual(payloads[0].agent, alex);
  // The followed user is the token owner, so it is tagged.
  assert.deepEqual(payloads[0].object, pat);

  // Alex's own channel, connections, block and comment are Alex's, not "me".
  const bookmarks = await run(ArenaBookmarksExtractor, { userId: 2 });
  assert.deepEqual(
    bookmarks.rows.map(r => r.extraction.recordType),
    ['channels', 'connections', 'blocks', 'comments', 'connections']
  );
  for (const payload of bookmarks.payloads) assert.deepEqual(payload.agent, alex);
});

test('stored credentials are used when no token is given, and required otherwise', async t => {
  const requests = fakeArena(t);
  await assert.rejects(new ArenaFollowingExtractor({}).setup(), /No Are\.na access token found/);

  await CredentialManager.storeCredentials('arena', {
    provider: 'arena',
    access_token: 'stored-token',
    token_type: 'static',
    created_at: '2025-01-01T00:00:00Z',
  });
  const extractor = new ArenaFollowingExtractor({});
  await extractor.setup();
  assert.equal(requests.at(-1).authorization, 'Bearer stored-token');
});
