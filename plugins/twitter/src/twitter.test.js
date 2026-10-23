import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { countMonth, findExports, writeZip } from '@chronicle.app/etl';
import {
  TwitterArchiveDirectMessagesExtractor,
  TwitterArchiveLikesExtractor,
  TwitterArchiveTweetsExtractor,
  TwitterTransformer,
} from '../dist/index.js';
import { archive, archiveFiles } from './fixture.test-helper.js';

async function records(Extractor, input, config = {}) {
  const extractor = new Extractor({ input, limit: 0, ...config });
  await extractor.setup();
  try {
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

/** How many records a run would read, counted as the runner does, after setup. */
async function count(Extractor, input, config = {}) {
  const extractor = new Extractor({ input, ...config });
  await extractor.setup();
  try {
    return await extractor.determineCount();
  } finally {
    await extractor.teardown();
  }
}

/** What a run with `config` would read, surveyed as the CLI asks, after setup. */
async function survey(Extractor, input, config = {}, options = {}) {
  const extractor = new Extractor({ input, ...config });
  await extractor.setup();
  try {
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}

/** What a survey should say of each kind a run yielded `rows` of: how many, and when by `time`. */
function surveyed(rows, kinds, time) {
  const expected = {};
  for (const kind of kinds) {
    const of = rows.filter(row => row.extraction.recordType === kind);
    const times = time ? of.map(row => time(row).getTime()) : [];
    expected[kind] = { count: of.length };
    if (times.length > 0) {
      expected[kind].earliest = new Date(Math.min(...times));
      expected[kind].latest = new Date(Math.max(...times));
    }
  }
  return expected;
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
  assert.equal(await count(TwitterArchiveTweetsExtractor, input), 2);

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
  assert.equal(await count(TwitterArchiveDirectMessagesExtractor, input), 2);

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

test('an archive reads the same zipped, and its layout finds it where it starts', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'twitter-zip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unzipped = archive(t);
  // Zipped as X hands it over, its files at the top of the zip.
  const zip = join(dir, 'twitter-2022-11-02-d627cfdf.zip');
  writeZip(zip, archiveFiles());
  for (const Extractor of [
    TwitterArchiveTweetsExtractor,
    TwitterArchiveLikesExtractor,
    TwitterArchiveDirectMessagesExtractor,
  ]) {
    const folder = await records(Extractor, unzipped);
    assert.ok(folder.length > 0, Extractor.name);
    assert.deepEqual(
      (await records(Extractor, zip)).map(r => [r.data, r.context]),
      folder.map(r => [r.data, r.context]),
      Extractor.name
    );
  }

  const { chronicle } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json')));
  const { layouts } = chronicle.sources.twitter.strategies.archive;
  const { exports } = await findExports(zip, [{ source: 'twitter', strategy: 'archive', layouts }]);
  assert.deepEqual(
    exports.map(e => e.root),
    [zip]
  );
  const found = await findExports(unzipped, [{ source: 'twitter', strategy: 'archive', layouts }]);
  assert.deepEqual(
    found.exports.map(e => e.root),
    [unzipped]
  );
});

test('a survey counts what a run reads, whatever its limit, and when each was posted or sent', async t => {
  const input = archive(t);
  const sent = row => new Date(row.data.created_at);

  // Tweets by when they were posted, within since as a run reads them.
  const since = new Date('2025-01-11T00:00:00Z');
  for (const config of [{}, { since }]) {
    const rows = await records(TwitterArchiveTweetsExtractor, input, config);
    assert.deepEqual(
      await survey(TwitterArchiveTweetsExtractor, input, { ...config, limit: 1 }),
      surveyed(rows, ['tweets'], sent)
    );
  }
  // By month when asked, in local time.
  const months = {};
  for (const row of await records(TwitterArchiveTweetsExtractor, input))
    countMonth(months, sent(row));
  const { tweets } = await survey(TwitterArchiveTweetsExtractor, input, {}, { byMonth: true });
  assert.deepEqual(tweets.byMonth, months);

  // The archive doesn't date likes, so a run reads every one and the survey only counts them.
  assert.deepEqual(
    await survey(TwitterArchiveLikesExtractor, input, { since, limit: 1 }),
    surveyed(await records(TwitterArchiveLikesExtractor, input, { since }), ['likes'])
  );

  // DMs by when they were sent, each kind with its conversations, and group DMs when included.
  const kinds = ['direct-messages', 'group-direct-messages'];
  for (const [config, read] of [
    [{}, kinds],
    [{ since: new Date('2025-01-12T00:00:00Z') }, kinds],
    [{ 'include-group-dms': false }, ['direct-messages']],
  ]) {
    const rows = await records(TwitterArchiveDirectMessagesExtractor, input, config);
    const expected = surveyed(rows, read, sent);
    for (const kind of read) {
      const ids = rows
        .filter(row => row.extraction.recordType === kind)
        .map(row => row.data.conversationId);
      expected[kind].measures = [
        { key: 'conversations', label: 'conversations', value: new Set(ids).size },
      ];
    }
    assert.deepEqual(
      await survey(TwitterArchiveDirectMessagesExtractor, input, { ...config, limit: 1 }),
      expected
    );
  }
});
