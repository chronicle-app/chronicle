import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TwitterArchiveDirectMessagesExtractor,
  TwitterArchiveLikesExtractor,
  TwitterArchiveTweetsExtractor,
  TwitterTransformer,
} from '../dist/index.js';
import { archive } from './fixture.test-helper.js';

async function records(Extractor, input, config = {}) {
  const extractor = new Extractor({ input, limit: 0, ...config });
  await extractor.setup();
  try {
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

async function transform(record) {
  const nodes = await new TwitterTransformer().performTransform(record);
  return nodes.map(n => n.data);
}

const key = ['@type', 'source', 'sourceId'];

const owner = {
  '@type': 'Agent',
  '@key': key,
  source: 'twitter',
  sourceId: '111',
  handle: 'owner_example',
  name: 'Owner Example',
  url: 'https://twitter.com/owner_example',
  sameAs: ['@me'],
};

const user = sourceId => ({ '@type': 'Agent', '@key': key, source: 'twitter', sourceId });

test('tweets become PublishActions of Posts with their mentions and links', async t => {
  const input = archive(t);
  const rows = await records(TwitterArchiveTweetsExtractor, input);
  assert.deepEqual(
    rows.map(r => r.extraction.recordType),
    ['tweets', 'tweets']
  );
  assert.equal(await new TwitterArchiveTweetsExtractor({ input }).determineCount(), 2);

  // Mentions and links come from the tweet's entities.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'PublishAction',
      '@key': key,
      source: 'twitter',
      sourceId: '1234567890123456789',
      timestamp: '2025-01-11T17:10:28.000Z',
      '@assertedAt': '2025-01-11T17:10:28.000Z',
      agent: owner,
      object: {
        '@type': 'Post',
        '@key': key,
        source: 'twitter',
        sourceId: '1234567890123456789',
        body: 'Trail notes with @alex_example https://t.co/abc123',
        author: [owner],
        references: [
          {
            '@type': 'Agent',
            '@key': key,
            source: 'twitter',
            sourceId: '222',
            handle: 'alex_example',
            name: 'Alex Example',
            url: 'https://twitter.com/alex_example',
          },
          { '@type': 'Entity', '@key': ['@type', 'url'], url: 'https://example.com/trail-notes' },
        ],
      },
    },
  ]);

  // With empty entities, mentions and links are parsed from the text.
  const [fallback] = await transform(rows[1]);
  assert.deepEqual(fallback.object.references, [
    {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'twitter',
      handle: 'sam_example',
      url: 'https://twitter.com/sam_example',
    },
    { '@type': 'Entity', '@key': ['@type', 'url'], url: 'https://example.com/map' },
  ]);

  // since/until apply to the tweet's creation time.
  const since = new Date('2025-01-11T00:00:00Z');
  assert.deepEqual(
    (await records(TwitterArchiveTweetsExtractor, input, { since })).map(r => r.data.id),
    ['1234567890123456789']
  );
});

test('likes become LikeActions on the liked Post', async t => {
  const input = archive(t);
  const rows = await records(TwitterArchiveLikesExtractor, input);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].extraction.recordType, 'likes');

  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'LikeAction',
      '@key': key,
      source: 'twitter',
      sourceId: '9876543210987654321-like',
      agent: owner,
      object: {
        '@type': 'Post',
        '@key': key,
        source: 'twitter',
        sourceId: '9876543210987654321',
        body: 'A tweet I liked from someone else',
      },
    },
  ]);
});

test('1:1 and group DMs become MessageActions, newest first', async t => {
  const input = archive(t);
  const rows = await records(TwitterArchiveDirectMessagesExtractor, input);
  assert.deepEqual(
    rows.map(r => r.extraction.recordType),
    ['group-direct-messages', 'direct-messages']
  );
  assert.equal(await new TwitterArchiveDirectMessagesExtractor({ input }).determineCount(), 2);

  // A group message is addressed to every other participant from the header.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'MessageAction',
      '@key': key,
      source: 'twitter',
      sourceId: '1300000000000000002',
      timestamp: '2025-01-12T09:00:00.000Z',
      '@assertedAt': '2025-01-12T09:00:00.000Z',
      agent: user('222'),
      object: {
        '@type': 'Message',
        '@key': key,
        source: 'twitter',
        sourceId: '1300000000000000002',
        body: 'Hello group, testing the archive export',
        recipient: [user('111'), user('333')],
        author: [user('222')],
      },
    },
  ]);

  assert.deepEqual(await transform(rows[1]), [
    {
      '@type': 'MessageAction',
      '@key': key,
      source: 'twitter',
      sourceId: '1300000000000000001',
      timestamp: '2025-01-11T17:10:28.000Z',
      '@assertedAt': '2025-01-11T17:10:28.000Z',
      agent: user('111'),
      object: {
        '@type': 'Message',
        '@key': key,
        source: 'twitter',
        sourceId: '1300000000000000001',
        body: 'Hey, testing the archive export',
        recipient: [user('222')],
        author: [user('111')],
      },
    },
  ]);

  // Group DMs can be left out.
  const oneOnOne = await records(TwitterArchiveDirectMessagesExtractor, input, {
    'include-group-dms': false,
  });
  assert.deepEqual(
    oneOnOne.map(r => r.data.id),
    ['1300000000000000001']
  );
});
