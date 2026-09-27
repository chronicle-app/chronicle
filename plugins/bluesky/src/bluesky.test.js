import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BlueskyFollowerExtractor,
  BlueskyFollowsExtractor,
  BlueskyLikesExtractor,
  BlueskyTransformer,
} from '../dist/index.js';
import {
  ACCESS_JWT,
  ALEX,
  HANDLE,
  ME,
  PASSWORD,
  POST_URI,
  RILEY,
  fakeBluesky,
} from './fixture.test-helper.js';

async function extract(Extractor, config) {
  const extractor = new Extractor(config);
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new BlueskyTransformer();
    const actions = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) actions.push(node.data);
    }
    return { keys: records.map(r => extractor.keyOf(r)), actions };
  } finally {
    await extractor.teardown();
  }
}

const key = ['@type', 'source', 'sourceId'];
const agent = (profile, isMe = false) => ({
  '@type': 'Agent',
  source: 'bluesky',
  sourceId: profile.did,
  '@key': key,
  name: profile.displayName,
  description: profile.description,
  ...(isMe && { sameAs: ['@me'] }),
});
const me = agent(ME, true);

test('follows become FollowActions from you, paging through every result', async t => {
  const { requests } = await fakeBluesky(t);
  const { keys, actions } = await extract(BlueskyFollowsExtractor, {
    handle: HANDLE,
    password: PASSWORD,
  });

  assert.deepEqual(keys, ['at://did:plc:sam/app.bsky.graph.follow/3kfollowalex']);
  assert.deepEqual(actions, [
    {
      '@type': 'FollowAction',
      source: 'bluesky',
      sourceId: 'did:plc:sam/app.bsky.graph.follow/3kfollowalex',
      // Dates stay Date objects. The follow record's own createdAt, fetched from
      // the repo.
      timestamp: new Date('2025-01-02T10:00:00.000Z'),
      '@assertedAt': new Date('2025-01-02T10:00:00.000Z'),
      '@key': key,
      agent: me,
      object: agent(ALEX),
    },
  ]);

  // The handle resolves to a DID, the password opens a session, and every later
  // call carries its token. The follows list is read until the cursor runs out.
  assert.deepEqual(
    requests.map(r => [r.method, r.endpoint, r.query.cursor, r.authorization]),
    [
      ['GET', 'com.atproto.identity.resolveHandle', undefined, undefined],
      ['POST', 'com.atproto.server.createSession', undefined, undefined],
      ['GET', 'app.bsky.actor.getProfile', undefined, `Bearer ${ACCESS_JWT}`],
      ['GET', 'app.bsky.graph.getFollows', undefined, `Bearer ${ACCESS_JWT}`],
      ['GET', 'app.bsky.graph.getFollows', 'page-2', `Bearer ${ACCESS_JWT}`],
      ['GET', 'com.atproto.repo.getRecord', undefined, `Bearer ${ACCESS_JWT}`],
    ]
  );
  assert.deepEqual(requests[1].body, { identifier: HANDLE, password: PASSWORD });
});

test('followers become FollowActions of you; an access token skips the login', async t => {
  const { requests } = await fakeBluesky(t);
  const { keys, actions } = await extract(BlueskyFollowerExtractor, {
    handle: HANDLE,
    accessToken: 'given-token',
  });

  assert.deepEqual(keys, ['at://did:plc:riley/app.bsky.graph.follow/3kfollowsam']);
  assert.deepEqual(actions, [
    {
      '@type': 'FollowAction',
      source: 'bluesky',
      sourceId: 'did:plc:riley/app.bsky.graph.follow/3kfollowsam',
      timestamp: new Date('2025-01-03T11:00:00.000Z'),
      '@assertedAt': new Date('2025-01-03T11:00:00.000Z'),
      '@key': key,
      agent: agent(RILEY),
      object: me,
    },
  ]);
  assert.ok(!requests.some(r => r.endpoint === 'com.atproto.server.createSession'));
  assert.equal(requests.at(-1).authorization, 'Bearer given-token');

  // No handle in the config and none stored (the credential store is empty).
  await assert.rejects(
    extract(BlueskyFollowerExtractor, { password: PASSWORD }),
    /Bluesky handle is required/
  );
});

test('a like becomes a LikeAction on the post and a PublishAction by its author', async t => {
  await fakeBluesky(t);
  const { keys, actions } = await extract(BlueskyLikesExtractor, {
    handle: HANDLE,
    password: PASSWORD,
  });

  const post = {
    '@type': 'Post',
    '@key': key,
    source: 'bluesky',
    sourceId: POST_URI.replace('at://', ''),
    body: 'Summit at sunrise',
    author: [agent(RILEY)],
    contains: [
      {
        '@type': 'ImageObject',
        '@key': ['url'],
        url: 'https://cdn.example.com/img/summit.jpg',
        width: 2000,
        height: 1500,
        description: 'The view from the top',
      },
      // Blank alt text is left out; no aspect ratio leaves the size unset.
      {
        '@type': 'ImageObject',
        '@key': ['url'],
        url: 'https://cdn.example.com/img/trail.jpg',
        width: undefined,
        height: undefined,
      },
    ],
  };
  assert.deepEqual(keys, ['at://did:plc:sam/app.bsky.feed.like/3klikepost']);
  assert.deepEqual(actions, [
    {
      '@type': 'LikeAction',
      source: 'bluesky',
      sourceId: 'did:plc:sam/app.bsky.feed.like/3klikepost',
      timestamp: new Date('2025-01-05T09:30:00.000Z'),
      '@assertedAt': new Date('2025-01-05T09:30:00.000Z'),
      '@key': key,
      agent: me,
      object: post,
    },
    {
      '@type': 'PublishAction',
      source: 'bluesky',
      sourceId: 'did:plc:riley/app.bsky.feed.post/3kpost',
      // When the post was written, not when you liked it.
      timestamp: new Date('2025-01-04T07:00:00.000Z'),
      '@assertedAt': new Date('2025-01-04T07:00:00.000Z'),
      '@key': key,
      agent: agent(RILEY),
      object: post,
    },
  ]);
});
