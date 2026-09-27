import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InstagramArchiveCommentsExtractor,
  InstagramArchiveFollowsExtractor,
  InstagramArchiveLikesExtractor,
  InstagramArchiveMessagesExtractor,
  InstagramArchivePostsExtractor,
  InstagramArchiveSavesExtractor,
  InstagramArchiveSearchesExtractor,
  InstagramArchiveStoriesExtractor,
  InstagramTransformer,
} from '../dist/index.js';
import {
  SELF,
  SHARE_SUFFIX,
  writeInstagramExport,
  writeInstagramExport2026Saves,
} from './fixture.test-helper.js';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'instagram-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function actions(Extractor, config) {
  const extractor = new Extractor(config);
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new InstagramTransformer();
    const out = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
    return out;
  } finally {
    await extractor.teardown();
  }
}

const handleKey = ['@type', 'source', 'handle'];
const postKey = ['@type', 'source', 'sourceId'];
const me = {
  '@type': 'Agent',
  '@key': handleKey,
  source: 'instagram',
  handle: SELF.username,
  sameAs: ['@me'],
  name: SELF.name,
};
const account = handle => ({
  '@type': 'Agent',
  '@key': handleKey,
  source: 'instagram',
  handle,
  url: `https://www.instagram.com/${handle}`,
});
const named = name => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'name'],
  source: 'instagram',
  name,
});
const at = timestamp => ({ timestamp, '@assertedAt': timestamp });

test('posts and stories become PublishActions of Posts containing their media', async t => {
  const dir = writeInstagramExport(tempDir(t));
  const posts = await actions(InstagramArchivePostsExtractor, { input: dir });
  // posts.json's reel, then posts_1.json's carousel. The flat duplicate of the
  // reel and the uri that escapes the export are dropped.
  assert.deepEqual(
    posts.map(a => a.object.sourceId),
    ['333333333', '111111111']
  );
  assert.deepEqual(posts[0], {
    '@type': 'PublishAction',
    '@key': ['@type', 'source', 'object.sourceId'],
    source: 'instagram',
    ...at('2024-08-30T06:40:00.000Z'),
    agent: me,
    object: {
      '@type': 'Post',
      '@key': postKey,
      source: 'instagram',
      sourceId: '333333333',
      sourceFormat: 'reel',
      body: 'Sunset reel',
      contains: [
        {
          '@type': 'VideoObject',
          '@key': postKey,
          contentPath: join(dir, 'media/posts/202409/333333333_c.mp4'),
          mimeType: 'video/mp4',
          source: 'instagram',
          sourceId: '333333333',
        },
      ],
    },
  });
  // The older shape has no caption on its media, so the entry's title is used.
  const carousel = posts[1].object;
  assert.equal(carousel.sourceFormat, 'feed');
  assert.equal(carousel.body, 'Trail day');
  assert.deepEqual(
    carousel.contains.map(m => [m['@type'], m.sourceId]),
    [
      ['ImageObject', '111111111'],
      ['ImageObject', '222222222'],
    ]
  );

  const since = await actions(InstagramArchivePostsExtractor, {
    input: dir,
    since: new Date('2020-01-01'),
  });
  assert.deepEqual(
    since.map(a => a.object.sourceId),
    ['333333333']
  );
  const counter = new InstagramArchivePostsExtractor({ input: dir });
  await counter.setup();
  assert.equal(await counter.determineCount(), 2);

  const stories = await actions(InstagramArchiveStoriesExtractor, { input: dir });
  assert.equal(stories.length, 2);
  assert.deepEqual(stories[0], {
    '@type': 'PublishAction',
    '@key': ['@type', 'source', 'object.sourceId'],
    source: 'instagram',
    ...at('2024-09-02T18:00:00.000Z'),
    agent: me,
    object: {
      '@type': 'Post',
      '@key': postKey,
      source: 'instagram',
      sourceId: '4444444444',
      sourceFormat: 'story',
      visibility: 'private',
      url: 'https://www.instagram.com/stories/archive/4444444444/',
      body: 'Morning coffee',
      contains: [
        {
          '@type': 'ImageObject',
          '@key': postKey,
          contentPath: join(dir, 'media/stories/202409/4444444444.jpg'),
          mimeType: 'image/jpeg',
          source: 'instagram',
          sourceId: '4444444444',
        },
      ],
    },
  });
  assert.equal(stories[1].object.contains[0]['@type'], 'VideoObject');
});

test('direct messages become MessageActions, with reactions as RespondActions', async t => {
  const dir = writeInstagramExport(tempDir(t));
  const out = await actions(InstagramArchiveMessagesExtractor, { input: dir });
  // Newest first. The reaction echo message is dropped; the reactions[] entries
  // on the messages they react to become RespondActions.
  assert.deepEqual(
    out.map(a => [a['@type'], a.object.sourceId]),
    [
      ['MessageAction', 'alexchen_123/1700000001000'],
      ['MessageAction', 'alexchen_123/1700000000000'],
      ['RespondAction', 'alexchen_123/1700000000000'],
      ['MessageAction', 'hikeclub_456/1690000000000'],
      ['RespondAction', 'hikeclub_456/1690000000000'],
    ]
  );
  const alex = account('alexchen');

  // Received in a 1:1 thread: the sender is the handle the folder name
  // resolves to, and a shared post is a referenced Post keyed by its shortcode.
  assert.deepEqual(out[0], {
    '@type': 'MessageAction',
    '@key': postKey,
    source: 'instagram',
    sourceId: 'alexchen_123/1700000001000',
    ...at('2023-11-14T22:13:21.000Z'),
    agent: alex,
    object: {
      '@type': 'Message',
      '@key': postKey,
      source: 'instagram',
      sourceId: 'alexchen_123/1700000001000',
      body: 'check this',
      recipient: [me],
      references: [
        {
          '@type': 'Post',
          '@key': postKey,
          source: 'instagram',
          sourceId: 'AbCdEfGhIjk',
          url: `https://www.instagram.com/p/AbCdEfGhIjk${SHARE_SUFFIX}/`,
          body: 'Pesto night',
          author: [account('cookbook.demo')],
        },
      ],
    },
  });

  const sent = {
    '@type': 'Message',
    '@key': postKey,
    source: 'instagram',
    sourceId: 'alexchen_123/1700000000000',
    body: 'hello',
    recipient: [alex],
  };
  assert.deepEqual(out[1].agent, me);
  assert.deepEqual(out[1].object, sent);
  assert.deepEqual(out[2], {
    '@type': 'RespondAction',
    '@key': ['@type', 'source', 'object.sourceId', 'agent.handle', 'agent.name', 'result.body'],
    source: 'instagram',
    ...at('2023-11-14T22:15:00.000Z'),
    agent: alex,
    object: sent,
    result: {
      '@type': 'Response',
      '@key': [
        '@type',
        'source',
        'body',
        'action.object.sourceId',
        'action.agent.handle',
        'action.agent.name',
      ],
      source: 'instagram',
      body: '❤️',
    },
  });

  // A group thread: members are known only by display name, and no recipient
  // is asserted. A reaction with no timestamp has no time.
  assert.deepEqual(out[3].agent, named('Jordan Lee'));
  assert.equal(out[3].object.recipient, undefined);
  assert.deepEqual(out[4].agent, named('Alex Chen'));
  assert.equal(out[4].timestamp, undefined);
  assert.equal(out[4]['@assertedAt'], undefined);
});

test('likes, follows, saves, comments and searches', async t => {
  const dir = writeInstagramExport(tempDir(t));

  const likes = await actions(InstagramArchiveLikesExtractor, { input: dir });
  // The 2025 story like carries no story id and is skipped.
  assert.deepEqual(
    likes.map(a => [a.object.sourceId, a.object.sourceFormat]),
    [
      ['C0ExampleA1', undefined],
      ['D_reelcodeAB', 'reel'],
      ['DM8bqanyyqK', undefined],
      ['3141592653589793', 'story'],
    ]
  );
  // The share suffix is trimmed from the key but kept in the url, and the
  // caption's mojibake is repaired.
  assert.deepEqual(likes[0], {
    '@type': 'LikeAction',
    '@key': ['@type', 'source', 'agent.handle', 'object.sourceId'],
    source: 'instagram',
    ...at('2024-08-30T06:40:00.000Z'),
    agent: me,
    object: {
      '@type': 'Post',
      '@key': postKey,
      source: 'instagram',
      sourceId: 'C0ExampleA1',
      url: `https://www.instagram.com/p/C0ExampleA1${SHARE_SUFFIX}/`,
      body: 'Café vibes',
      author: [account('alexchen')],
    },
  });
  // The 2025 dialect's 👍 marker is not a caption.
  assert.equal(likes[2].object.body, undefined);
  assert.deepEqual(likes[2].object.author, [account('jordanlee')]);

  const follows = await actions(InstagramArchiveFollowsExtractor, { input: dir });
  assert.deepEqual(
    follows.map(a => [a.agent.handle, a.object.handle, a.timestamp]),
    [
      [SELF.username, 'alexchen', '2020-09-13T12:26:40.000Z'],
      [SELF.username, 'jordanlee', '2025-07-25T19:52:06.000Z'],
      ['alexchen', SELF.username, '2021-01-07T06:13:20.000Z'],
    ]
  );
  assert.deepEqual(follows[0], {
    '@type': 'FollowAction',
    '@key': ['@type', 'source', 'agent.handle', 'object.handle'],
    source: 'instagram',
    ...at('2020-09-13T12:26:40.000Z'),
    agent: me,
    object: account('alexchen'),
  });

  const saves = await actions(InstagramArchiveSavesExtractor, { input: dir });
  assert.deepEqual(
    saves.map(a => [a.object.sourceId, a.target?.name, a.timestamp]),
    [
      // The label_values collection: items take the collection's update time.
      ['AbCdEfGhIjk', 'Recipes', '2024-07-03T09:46:40.000Z'],
      // The 2025 flat list: the header names the collection, items keep their time.
      ['CExample-B2', 'Travel', '2020-07-03T19:11:47.000Z'],
      // saved_posts.json: no collection.
      ['DBRLoj_JRfv', undefined, '2024-10-18T17:04:31.000Z'],
    ]
  );
  assert.deepEqual(saves[1], {
    '@type': 'BookmarkAction',
    '@key': ['@type', 'source', 'object.sourceId', 'target.name'],
    source: 'instagram',
    ...at('2020-07-03T19:11:47.000Z'),
    agent: me,
    object: {
      '@type': 'Post',
      '@key': postKey,
      source: 'instagram',
      sourceId: 'CExample-B2',
      url: 'https://www.instagram.com/p/CExample-B2/',
      author: [account('travel.demo')],
    },
    target: {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'name'],
      source: 'instagram',
      name: 'Travel',
    },
  });
  assert.equal(saves[2].object.sourceFormat, 'reel');

  const comments = await actions(InstagramArchiveCommentsExtractor, { input: dir });
  // Two identical comments to the same account stay distinct by time.
  assert.deepEqual(
    comments.map(a => [a.object.body, a.object.references[0].handle, a.timestamp]),
    [
      ['Congrats!', 'alexchen', '2024-05-06T12:53:20.000Z'],
      ['Congrats!', 'alexchen', '2024-05-18T02:40:00.000Z'],
      ['Nice reel', 'jordanlee', '2024-05-29T16:26:40.000Z'],
    ]
  );
  assert.deepEqual(comments[0], {
    '@type': 'CreateAction',
    '@key': ['@type', 'source', 'object.references[*].handle', 'object.body', 'timestamp'],
    source: 'instagram',
    ...at('2024-05-06T12:53:20.000Z'),
    agent: me,
    object: {
      '@type': 'Comment',
      '@key': ['@type', 'source', 'references[*].handle', 'body', 'action.timestamp'],
      source: 'instagram',
      body: 'Congrats!',
      references: [account('alexchen')],
    },
  });

  const searches = await actions(InstagramArchiveSearchesExtractor, { input: dir });
  const findKey = ['@type', 'source', 'object.handle', 'object.body', 'timestamp'];
  assert.deepEqual(searches, [
    // 2026 dialect: the handle is the entry's title.
    {
      '@type': 'FindAction',
      '@key': findKey,
      source: 'instagram',
      ...at('2026-06-25T19:56:36.000Z'),
      agent: me,
      object: account('jordanlee'),
    },
    // 2025 dialect: Search and Time in string_map_data.
    {
      '@type': 'FindAction',
      '@key': findKey,
      source: 'instagram',
      ...at('2025-08-07T04:29:12.000Z'),
      agent: me,
      object: account('alexchen'),
    },
    {
      '@type': 'FindAction',
      '@key': findKey,
      source: 'instagram',
      ...at('2025-08-07T04:29:08.000Z'),
      agent: me,
      object: {
        '@type': 'Query',
        '@key': ['@type', 'source', 'body'],
        source: 'instagram',
        name: 'vegan ramen',
        body: 'vegan ramen',
      },
    },
  ]);
});

test('2026 saves: bare lists with the owner in a nested Owner dict', async t => {
  const dir = writeInstagramExport2026Saves(tempDir(t));
  const saves = await actions(InstagramArchiveSavesExtractor, { input: dir });
  // This export's profile carries a username and no name.
  const owner = {
    '@type': 'Agent',
    '@key': handleKey,
    source: 'instagram',
    handle: SELF.username,
    sameAs: ['@me'],
  };
  assert.deepEqual(saves, [
    {
      '@type': 'BookmarkAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.name'],
      source: 'instagram',
      ...at('2020-06-28T05:27:50.000Z'),
      agent: owner,
      object: {
        '@type': 'Post',
        '@key': postKey,
        source: 'instagram',
        sourceId: 'CExample-B2',
        url: 'https://www.instagram.com/p/CExample-B2/',
        author: [account('travel.demo')],
      },
      target: {
        '@type': 'Collection',
        '@key': ['@type', 'source', 'name'],
        source: 'instagram',
        name: 'Recipes',
      },
    },
    {
      '@type': 'BookmarkAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.name'],
      source: 'instagram',
      ...at('2026-03-05T20:17:58.000Z'),
      agent: owner,
      object: {
        '@type': 'Post',
        '@key': postKey,
        source: 'instagram',
        sourceId: 'DExampleC3x',
        sourceFormat: 'reel',
        url: 'https://www.instagram.com/reel/DExampleC3x/',
        author: [account('reels.demo')],
      },
    },
  ]);
});

test('an export with no username fails instead of inventing an owner', async t => {
  const dir = writeInstagramExport(tempDir(t), { withProfile: false });
  await assert.rejects(
    actions(InstagramArchiveFollowsExtractor, { input: dir }),
    /no account username/
  );
});
