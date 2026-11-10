import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { countMonth, findExports, writeZip } from '@chronicle.app/etl';
import { nodeKey } from '@chronicle.app/schema';
import {
  TwitterApiBookmarksExtractor,
  TwitterApiLikesExtractor,
  TwitterApiMentionsExtractor,
  TwitterApiTweetsExtractor,
  TwitterArchiveDirectMessagesExtractor,
  TwitterArchiveLikesExtractor,
  TwitterArchiveTweetsExtractor,
  TwitterTransformer,
} from '../dist/index.js';
import {
  GENERATED,
  TOKEN,
  acted,
  archive,
  archiveFiles,
  me,
  serveX,
  ytd,
} from './fixture.test-helper.js';

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
  url: 'https://x.com/owner_example',
  sameAs: ['@me'],
};

const user = sourceId => ({ '@type': 'Agent', '@key': key, source: 'twitter', sourceId });

/** The tag a #Hiking or #hiking makes. */
const hiking = {
  '@type': 'Tag',
  '@key': ['@type', 'source', 'handle'],
  source: 'twitter',
  handle: 'hiking',
};

test('tweets become PublishActions of Posts with their mentions, links, and hashtags', async t => {
  const input = archive(t);
  const rows = await records(TwitterArchiveTweetsExtractor, input);
  assert.deepEqual(
    rows.map(r => r.extraction.recordType),
    ['tweets', 'tweets']
  );
  assert.equal(await count(TwitterArchiveTweetsExtractor, input), 2);

  // Mentions, links, and hashtags come from the tweet's entities.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'PublishAction',
      '@key': ['@type', 'source', 'result.sourceId'],
      source: 'twitter',
      timestamp: '2025-01-11T17:10:28.000Z',
      // What the archive says is as of when X generated it, an old tweet's too.
      '@assertedAt': GENERATED,
      agent: owner,
      result: {
        '@type': 'Post',
        '@key': key,
        source: 'twitter',
        sourceId: '1234567890123456789',
        url: 'https://x.com/owner_example/status/1234567890123456789',
        body: 'Trail notes with @alex_example #Hiking https://t.co/abc123',
        author: [owner],
        references: [
          {
            '@type': 'Agent',
            '@key': key,
            source: 'twitter',
            sourceId: '222',
            handle: 'alex_example',
            name: 'Alex Example',
            url: 'https://x.com/alex_example',
          },
          { '@type': 'Entity', '@key': ['@type', 'url'], url: 'https://example.com/trail-notes' },
        ],
        about: [hiking],
      },
    },
  ]);

  // A photo is the archive's copy of the file, keyed by X's media id.
  const [withPhoto] = await transform(rows[1]);
  assert.deepEqual(withPhoto.result.contains, [
    {
      '@type': 'ImageObject',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: '1500000000000000001',
      url: 'https://pbs.twimg.com/media/Trail1.jpg',
      contentPath: join(input, 'data/tweets_media/1234567890123456788-Trail1.jpg'),
      mimeType: 'image/jpeg',
    },
  ]);

  // With empty entities, mentions and links are parsed from the text, but
  // not the link to the tweet's own photo.
  const [fallback] = await transform(rows[1]);
  assert.deepEqual(fallback.result.references, [
    {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'twitter',
      handle: 'sam_example',
      url: 'https://x.com/sam_example',
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
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: 'twitter',
      // The archive doesn't say when you liked it, but it says you had by the time X generated it.
      '@assertedAt': GENERATED,
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

test('an archive without a manifest is asserted when X wrote its account file', async t => {
  const files = archiveFiles();
  delete files['data/manifest.js'];
  const input = archive(t, files);
  const written = new Date('2025-02-14T08:00:00.000Z');
  utimesSync(join(input, 'data/account.js'), written, written);
  const [tweet] = await records(TwitterArchiveTweetsExtractor, input);
  const [published] = await transform(tweet);
  assert.equal(published['@assertedAt'], written.toISOString());
  // Its place on the timeline is still when it was posted.
  assert.equal(published.timestamp, '2025-01-11T17:10:28.000Z');
});

test('1:1 and group DMs become MessageActions, newest first', async t => {
  const input = archive(t);
  const rows = await records(TwitterArchiveDirectMessagesExtractor, input);
  assert.deepEqual(
    rows.map(r => r.extraction.recordType),
    ['group-direct-messages', 'direct-messages']
  );
  assert.equal(await count(TwitterArchiveDirectMessagesExtractor, input), 2);

  // A group message is addressed to everyone else in the group when it was sent.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'MessageAction',
      '@key': ['@type', 'source', 'result.sourceId'],
      source: 'twitter',
      timestamp: '2025-01-12T09:00:00.000Z',
      '@assertedAt': GENERATED,
      agent: user('222'),
      result: {
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
      '@key': ['@type', 'source', 'result.sourceId'],
      source: 'twitter',
      timestamp: '2025-01-11T17:10:28.000Z',
      '@assertedAt': GENERATED,
      agent: user('111'),
      result: {
        '@type': 'Message',
        '@key': key,
        source: 'twitter',
        sourceId: '1300000000000000001',
        body: 'Hey, testing the archive export',
        recipient: [user('222')],
        author: [user('111')],
        // A message's photo has no media id, so its URL keys it.
        contains: [
          {
            '@type': 'ImageObject',
            '@key': ['@type', 'url'],
            url: 'https://ton.twitter.com/dm/1300000000000000001/1500000000000000002/Map.jpg',
            contentPath: join(input, 'data/direct_messages_media/1300000000000000001-Map.jpg'),
            mimeType: 'image/jpeg',
          },
        ],
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

/** A group message event, as the archive has it. */
const sent = (id, senderId, createdAt) => ({
  messageCreate: { id, senderId, text: 'Hi all', createdAt, mediaUrls: [], urls: [] },
});

test('a group message goes to whoever was in the group when it was sent', async t => {
  const input = archive(t, {
    ...archiveFiles(),
    // Newest first, as X lists them.
    'data/direct-messages-group.js': ytd('direct_messages_group', [
      {
        dmConversation: {
          conversationId: '1400000000000000002',
          messages: [
            sent('1300000000000000004', '111', '2025-02-01T10:00:00.000Z'),
            { participantsLeave: { userIds: ['333'], createdAt: '2025-02-01T09:30:00.000Z' } },
            {
              participantsJoin: {
                initiatingUserId: '222',
                userIds: ['444'],
                createdAt: '2025-02-01T09:20:00.000Z',
              },
            },
            sent('1300000000000000003', '333', '2025-02-01T09:10:00.000Z'),
            // You joined it: who was in it then.
            {
              joinConversation: {
                initiatingUserId: '222',
                participantsSnapshot: ['111', '222', '333'],
                createdAt: '2025-02-01T09:00:00.000Z',
              },
            },
          ],
        },
      },
      {
        // A group you started has no snapshot: everyone who wrote in it was
        // in it, unless X records them joining.
        dmConversation: {
          conversationId: '1400000000000000003',
          messages: [
            sent('1300000000000000006', '555', '2025-02-02T11:10:00.000Z'),
            {
              participantsJoin: {
                initiatingUserId: '111',
                userIds: ['666'],
                createdAt: '2025-02-02T11:05:00.000Z',
              },
            },
            sent('1300000000000000005', '111', '2025-02-02T11:00:00.000Z'),
          ],
        },
      },
    ]),
  });
  const rows = await records(TwitterArchiveDirectMessagesExtractor, input);
  const recipients = {};
  for (const row of rows.filter(r => r.data.type === 'group-direct-message')) {
    const [action] = await transform(row);
    recipients[row.data.id] = action.result.recipient.map(agent => agent.sourceId);
  }
  assert.deepEqual(recipients, {
    // 444 joined and 333 left before this one.
    '1300000000000000004': ['222', '444'],
    '1300000000000000003': ['111', '222'],
    // 666 joined between these two.
    '1300000000000000006': ['111', '666'],
    '1300000000000000005': ['555'],
  });
});

test('text has X’s HTML escapes undone', async t => {
  const input = archive(t);
  const escaped = 'Fish &amp; chips &lt;3 &quot;now&quot; &#8730;2, and &amp;lt; as typed';
  const written = 'Fish & chips <3 "now" √2, and &lt; as typed';
  const [tweet] = await records(TwitterArchiveTweetsExtractor, input);
  const [published] = await transform({ ...tweet, data: { ...tweet.data, text: escaped } });
  assert.equal(published.result.body, written);
  const [like] = await records(TwitterArchiveLikesExtractor, input);
  const [liked] = await transform({ ...like, data: { ...like.data, fullText: escaped } });
  assert.equal(liked.object.body, written);
  for (const message of await records(TwitterArchiveDirectMessagesExtractor, input)) {
    const [sent] = await transform({ ...message, data: { ...message.data, text: escaped } });
    assert.equal(sent.result.body, written);
  }
});

/** Where each record's media files are on disk. */
const mediaPaths = rows => rows.flatMap(r => (r.data.media ?? []).map(item => item.path));

/** A record's data and context, without where its media files are on disk. */
const portable = r => [
  { ...r.data, ...(r.data.media && { media: r.data.media.map(({ path, ...item }) => item) }) },
  r.context,
];

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
    // A zip's media is copied out to read, so only where it's copied to differs.
    const zipped = await records(Extractor, zip);
    assert.equal(mediaPaths(zipped).length, mediaPaths(folder).length);
    assert.ok(mediaPaths(zipped).every(path => !path.startsWith(unzipped)));
    assert.deepEqual(
      zipped.map(r => portable(r)),
      folder.map(r => portable(r)),
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

/** What a run through the (fake) X API extracts. */
async function fromApi(Extractor, config = {}) {
  const extractor = new Extractor({ accessToken: TOKEN, limit: 0, ...config });
  await extractor.setup();
  try {
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

const iso = ms => new Date(ms).toISOString();
/** An instant to the second it's in. */
const second = ms => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

test('likes through the API come newest first, each with when it was liked', async t => {
  const likes = acted(24);
  likes[4].text = 'Trail notes with @alex_example #Hiking #hiking https://t.co/abc123';
  likes[4].entities = {
    mentions: [{ username: 'alex_example', id: '222', start: 17, end: 30 }],
    urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.com/trail' }],
    hashtags: [
      { tag: 'Hiking', start: 31, end: 38 },
      { tag: 'hiking', start: 39, end: 46 },
    ],
  };
  likes[4].media = [
    {
      media_key: '3_1500000000000000003',
      type: 'photo',
      url: 'https://pbs.twimg.com/media/Trail2.jpg',
      width: 1200,
      height: 800,
      alt_text: 'A trail through the woods',
    },
  ];
  await serveX(t, { likes });
  const rows = await fromApi(TwitterApiLikesExtractor);
  assert.deepEqual(
    rows.map(row => row.data.tweetId),
    likes.map(like => like.id)
  );
  // X's paging gives most to the millisecond. A search gets the newest few,
  // which have nothing above them to start a page from, to the second, and
  // the oldest, which no page ends on.
  assert.deepEqual(
    rows.map(row => row.data.likedAt),
    likes.map((like, k) => (k < 4 || k === likes.length - 1 ? second(like.at) : iso(like.at)))
  );

  const timed = rows[4];
  assert.equal(timed.label.title, timed.data.fullText);
  assert.deepEqual(await transform(timed), [
    {
      '@type': 'LikeAction',
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: 'twitter',
      timestamp: timed.data.likedAt,
      '@assertedAt': timed.data.likedAt,
      agent: owner,
      object: {
        '@type': 'Post',
        '@key': key,
        source: 'twitter',
        sourceId: timed.data.tweetId,
        body: timed.data.fullText,
        author: [user(timed.data.authorId)],
        // Its mentions and links, as a tweet of yours has.
        references: [
          { ...user('222'), handle: 'alex_example', url: 'https://x.com/alex_example' },
          { '@type': 'Entity', '@key': ['@type', 'url'], url: 'https://example.com/trail' },
        ],
        // Its hashtags, each once whatever its case.
        about: [hiking],
        // Its photo, keyed by X's media id as the archive's is.
        contains: [
          {
            '@type': 'ImageObject',
            '@key': ['@type', 'source', 'sourceId'],
            source: 'twitter',
            sourceId: '1500000000000000003',
            url: 'https://pbs.twimg.com/media/Trail2.jpg',
            mimeType: 'image/jpeg',
            width: 1200,
            height: 800,
            caption: 'A trail through the woods',
          },
        ],
      },
    },
  ]);

  // The API's entities are complete: text that looks like a mention or a
  // link without one isn't taken as one.
  const plain = rows[5];
  assert.equal(
    (
      await transform({ ...plain, data: { ...plain.data, fullText: 'Write to pat@example.com' } })
    )[0].object.references,
    undefined
  );

  // A like whose time can't be found has the stretch it's in, and the
  // action the shortest day, month, or year that holds it.
  const during = async likedDuring => {
    const data = { ...timed.data, likedDuring };
    delete data.likedAt;
    const [like] = await transform({ ...timed, data });
    return like.timestamp;
  };
  assert.equal(await during('2025-03-01T10:00:00.000Z/2025-03-02T00:00:00.000Z'), '2025-03-01');
  assert.equal(await during('2025-03-01T10:00:00.000Z/2025-03-05T00:00:00.000Z'), '2025-03');
  assert.equal(await during('2024-12-31T10:00:00.000Z/2025-01-01T10:00:00.000Z'), undefined);
});

test('a poll spends its requests on the likes since the last one', async t => {
  const likes = acted(30);
  const requests = await serveX(t, { likes });
  // Half an hour after the newest like, since 90 minutes before it: two new likes.
  const rows = await fromApi(TwitterApiLikesExtractor, {
    since: new Date(likes[0].at - 90 * 60_000),
    until: new Date(likes[0].at + 30 * 60_000),
  });
  assert.deepEqual(
    rows.map(row => row.data.likedAt),
    [second(likes[0].at), second(likes[1].at)]
  );
  // A dozen or so requests for each, to find it to the second.
  assert.ok(requests.filter(r => r.path.endsWith('/liked_tweets')).length <= 30);
});

test('a like is one per account: the archive and the API agree, another account’s is its own', async t => {
  const [fromArchive] = await records(TwitterArchiveLikesExtractor, archive(t));
  const likes = acted(5);
  likes[4].id = fromArchive.data.tweetId;
  await serveX(t, { likes });
  const viaApi = (await fromApi(TwitterApiLikesExtractor))[4];
  const otherAccount = {
    ...viaApi,
    context: {
      ...viaApi.context,
      accountInfo: { accountId: '444', username: 'other_example', accountDisplayName: 'Other' },
    },
  };

  const [archived] = await transform(fromArchive);
  const [api] = await transform(viaApi);
  const [other] = await transform(otherAccount);
  assert.equal(nodeKey(api), nodeKey(archived));
  assert.notEqual(nodeKey(other), nodeKey(api));
});

test('bookmarks through the API become BookmarkActions at the time of each', async t => {
  const bookmarks = acted(3, { idBase: 1800 });
  bookmarks[0].author = { id: bookmarks[0].author_id, username: 'alex_example', name: 'Alex' };
  const requests = await serveX(t, { bookmarks });
  const rows = await fromApi(TwitterApiBookmarksExtractor);
  assert.deepEqual(
    rows.map(row => [row.data.bookmarkedAt, row.data.bookmarkedDuring]),
    [
      [iso(bookmarks[0].at), undefined],
      [iso(bookmarks[1].at), undefined],
      // No page ends on the oldest, so a search finds it to the second.
      [second(bookmarks[2].at), undefined],
    ]
  );
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'BookmarkAction',
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: 'twitter',
      timestamp: iso(bookmarks[0].at),
      '@assertedAt': iso(bookmarks[0].at),
      agent: owner,
      object: {
        '@type': 'Post',
        '@key': key,
        source: 'twitter',
        sourceId: bookmarks[0].id,
        // Its page, under its author's handle, as a browser has it.
        url: `https://x.com/alex_example/status/${bookmarks[0].id}`,
        body: bookmarks[0].text,
        author: [
          {
            ...user(bookmarks[0].author_id),
            handle: 'alex_example',
            url: 'https://x.com/alex_example',
            name: 'Alex',
          },
        ],
      },
    },
  ]);
  // Each read asks who posted each bookmark, for the handle.
  assert.ok(
    requests
      .filter(r => r.path.endsWith('/bookmarks'))
      .every(r => r.query.expansions.split(',').includes('author_id'))
  );

  // A limited run asks X for no more than it keeps: X bills each post.
  requests.length = 0;
  assert.equal((await fromApi(TwitterApiBookmarksExtractor, { limit: 1 })).length, 1);
  assert.deepEqual(
    requests.filter(r => r.path.endsWith('/bookmarks')).map(r => r.query.max_results),
    ['1']
  );
});

test('since and until bound likes by when each was liked', async t => {
  const likes = acted(30);
  await serveX(t, { likes });
  const rows = await fromApi(TwitterApiLikesExtractor, {
    until: new Date(likes[10].at),
    since: new Date(likes[24].at),
  });
  assert.deepEqual(
    rows.map(row => row.data.tweetId),
    likes.slice(11, 25).map(like => like.id)
  );
  // The first few are found by a search between the window's ends.
  assert.equal(rows[0].data.likedAt, second(likes[11].at));
});

test('likes come without times when X’s paging carries none', async t => {
  const likes = acted(12);
  const requests = await serveX(t, { likes, opaque: true });
  const rows = await fromApi(TwitterApiLikesExtractor);
  assert.deepEqual(
    rows.map(row => row.data.tweetId),
    likes.map(like => like.id)
  );
  assert.ok(rows.every(row => !('likedAt' in row.data) && !('likedDuring' in row.data)));
  // With nothing to time, the pages after the first are full.
  assert.deepEqual(
    requests.filter(r => r.path.endsWith('/liked_tweets')).map(r => r.query.max_results),
    ['5', '100']
  );
});

test('tweets through the API take the archive’s shape', async t => {
  const tweets = [
    {
      id: '1700000000000000001',
      text: 'Trail notes with @alex_example https://t.co/abc123',
      created_at: '2025-02-01T10:00:00.000Z',
      public_metrics: { like_count: 3, retweet_count: 1 },
      entities: {
        mentions: [{ username: 'alex_example', id: '222', start: 17, end: 30 }],
        urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.com/trail' }],
      },
    },
  ];
  const requests = await serveX(t, { tweets });
  // The timeline starts in November 2010, so an earlier since asks for all of it.
  const rows = await fromApi(TwitterApiTweetsExtractor, { since: new Date('2009-01-01') });
  assert.equal(requests.at(-1).query.start_time, undefined);
  assert.equal(rows.length, 1);
  const [publish] = await transform(rows[0]);
  assert.equal(publish['@type'], 'PublishAction');
  assert.equal(publish.timestamp, '2025-02-01T10:00:00.000Z');
  assert.deepEqual(publish.result.references.map(ref => ref.sourceId ?? ref.url).sort(), [
    '222',
    'https://example.com/trail',
  ]);
});

const alex = { id: '222', username: 'alex_example', name: 'Alex Example' };
const alexAgent = {
  ...user('222'),
  handle: 'alex_example',
  url: 'https://x.com/alex_example',
  name: 'Alex Example',
};

test('tweets that mention you become their authors’ PublishActions, with a video', async t => {
  const mentions = [
    {
      id: '1700000000000000010',
      text: '@owner_example the trail map, as promised',
      created_at: '2025-02-02T08:00:00.000Z',
      entities: {
        mentions: [{ username: me.username, id: me.id, start: 0, end: 14 }],
        urls: [
          {
            url: 'https://t.co/vid',
            expanded_url: 'https://x.com/alex_example/status/1700000000000000010/video/1',
            media_key: '7_1500000000000000004',
          },
        ],
      },
      author: alex,
      media: [
        {
          media_key: '7_1500000000000000004',
          type: 'video',
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/v/pl.m3u8' },
            {
              bit_rate: 256_000,
              content_type: 'video/mp4',
              url: 'https://video.twimg.com/v/low.mp4',
            },
            {
              bit_rate: 2_176_000,
              content_type: 'video/mp4',
              url: 'https://video.twimg.com/v/high.mp4?tag=1',
            },
          ],
        },
      ],
    },
  ];
  const requests = await serveX(t, { mentions });
  const rows = await fromApi(TwitterApiMentionsExtractor);
  assert.deepEqual(
    rows.map(row => row.extraction.recordType),
    ['mentions']
  );
  // Who posted it is asked for, as it's someone else.
  assert.match(requests.at(-1).query.expansions, /author_id/);

  const [publish] = await transform(rows[0]);
  assert.equal(publish['@type'], 'PublishAction');
  assert.deepEqual(publish.agent, alexAgent);
  assert.deepEqual(publish.result.author, [alexAgent]);
  // You're among those it mentions: the same account as your own tweets'.
  const you = publish.result.references.find(ref => ref.sourceId === me.id);
  assert.equal(nodeKey(you), nodeKey(owner));
  // The link to its own video isn't one of them: the video is attached.
  assert.equal(publish.result.references.length, 1);
  // A video is its best MP4.
  assert.deepEqual(publish.result.contains, [
    {
      '@type': 'VideoObject',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: '1500000000000000004',
      url: 'https://video.twimg.com/v/high.mp4?tag=1',
      mimeType: 'video/mp4',
    },
  ]);
});

test('a retweet becomes your ShareAction of the post, in full when X still has it', async t => {
  const original = {
    id: '1600000000000000001',
    text: 'The whole trail, start to finish, in one long post that a retweet cuts short',
    created_at: '2025-02-01T09:00:00.000Z',
    author: alex,
  };
  const tweets = [
    {
      id: '1700000000000000020',
      text: 'RT @alex_example: The whole trail, start to finish, in one…',
      created_at: '2025-02-03T10:00:00.000Z',
      referenced_tweets: [{ type: 'retweeted', id: original.id }],
      entities: { mentions: [{ username: 'alex_example', id: '222', start: 3, end: 16 }] },
    },
    {
      id: '1700000000000000021',
      text: 'RT @gone_example: deleted since',
      created_at: '2025-02-02T10:00:00.000Z',
      referenced_tweets: [{ type: 'retweeted', id: '1600000000000000002' }],
    },
  ];
  await serveX(t, { tweets, posts: [original] });
  const rows = await fromApi(TwitterApiTweetsExtractor);

  const [share] = await transform(rows[0]);
  assert.deepEqual(share, {
    '@type': 'ShareAction',
    '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
    source: 'twitter',
    timestamp: '2025-02-03T10:00:00.000Z',
    '@assertedAt': '2025-02-03T10:00:00.000Z',
    agent: owner,
    object: {
      '@type': 'Post',
      '@key': key,
      source: 'twitter',
      sourceId: original.id,
      url: `https://x.com/alex_example/status/${original.id}`,
      body: original.text,
      author: [alexAgent],
    },
  });
  // One X no longer has is just which post it was.
  const [gone] = await transform(rows[1]);
  assert.deepEqual(gone.object, {
    '@type': 'Post',
    '@key': key,
    source: 'twitter',
    sourceId: '1600000000000000002',
  });
});

test('an archive run needs a Twitter archive', async () => {
  await assert.rejects(records(TwitterArchiveTweetsExtractor), error => {
    assert.equal(error.code, 'input-not-found');
    assert.equal(error.exitCode, 4);
    assert.match(error.hint, /--input/);
    return true;
  });
});

test('a token X rejects asks the user to sign in again', async t => {
  await serveX(t);
  await assert.rejects(fromApi(TwitterApiLikesExtractor, { accessToken: 'stale' }), error => {
    assert.equal(error.code, 'auth-required');
    assert.match(error.hint, /chronicle auth login twitter/);
    return true;
  });
});

test('loading the plugin registers the X OAuth provider', () => {
  const provider = OAuthProviderRegistry.get('twitter');
  assert.equal(provider?.pkce, true);
  assert.equal(provider.tokenAuthStyle, 'basic-header');
  assert.ok(provider.scopes.includes('offline.access'));
});
