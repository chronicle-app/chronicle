import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HackerNewsCommentsExtractor,
  HackerNewsRepliesExtractor,
  HackerNewsSubmissionsExtractor,
  HackerNewsTransformer,
} from '../dist/index.js';
import { USERNAME, at, fakeHackerNews } from './fixture.test-helper.js';

async function extract(Extractor, config = { username: USERNAME }) {
  const extractor = new Extractor(config);
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new HackerNewsTransformer();
    const actions = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) actions.push(node.data);
    }
    return { keys: records.map(r => extractor.keyOf(r)), actions };
  } finally {
    await extractor.teardown();
  }
}

const source = 'hackernews';
const key = ['@type', 'source', 'sourceId'];
const url = id => `https://news.ycombinator.com/item?id=${id}`;
const date = id => new Date(at(id) * 1000);

const userKey = ['@type', 'source', 'handle'];
const sam = {
  '@type': 'Agent',
  '@key': userKey,
  source,
  handle: 'sam',
  url: 'https://news.ycombinator.com/user?id=sam',
  sameAs: ['@me'],
  description: 'Bread and bikes.',
};
const user = name => ({
  '@type': 'Agent',
  '@key': userKey,
  source,
  handle: name,
  url: `https://news.ycombinator.com/user?id=${name}`,
});
const alex = user('alex');
const riley = user('riley');

const link = href => ({ '@type': 'Entity', '@key': ['url'], url: href });
const post = (id, author, fields) => ({
  '@type': 'Post',
  '@key': key,
  source,
  sourceId: String(id),
  url: url(id),
  author: [author],
  ...fields,
});
const bread = post(100, sam, {
  name: 'Sourdough at altitude',
  references: [link('https://example.com/bread')],
});
const trails = post(101, riley, {
  name: 'Show HN: A trail map',
  references: [link('https://example.com/trails')],
});
const comment = (id, author, body, about) => ({
  '@type': 'Comment',
  '@key': key,
  source,
  sourceId: String(id),
  url: url(id),
  body,
  author: [author],
  about: [about],
});
const respond = (id, agent, object, result) => ({
  '@type': 'RespondAction',
  '@key': key,
  source,
  sourceId: String(id),
  timestamp: date(id),
  '@assertedAt': date(id),
  agent,
  object,
  result,
});

test('submissions become PublishActions of stories, Ask HN posts, and polls', async t => {
  await fakeHackerNews(t);
  const { keys, actions } = await extract(HackerNewsSubmissionsExtractor);

  assert.deepEqual(keys, ['105', '103', '100']);
  const publish = (id, object) => ({
    '@type': 'PublishAction',
    '@key': key,
    source,
    sourceId: String(id),
    timestamp: date(id),
    '@assertedAt': date(id),
    agent: sam,
    object,
  });
  assert.deepEqual(actions, [
    publish(105, post(105, sam, { name: 'Favourite flour?' })),
    publish(
      103,
      post(103, sam, {
        name: 'Ask HN: What do you bake?',
        body: 'Weekends only.\nSee my starter (https://example.com/starter).',
      })
    ),
    publish(100, bread),
  ]);
});

test('`since` ends the walk at the first older submission', async t => {
  await fakeHackerNews(t);
  const { keys } = await extract(HackerNewsSubmissionsExtractor, {
    username: USERNAME,
    since: date(104),
  });
  assert.deepEqual(keys, ['105']);
});

test('a removed submission, with no time, is skipped without ending the walk', async t => {
  await fakeHackerNews(t);
  const { keys } = await extract(HackerNewsSubmissionsExtractor, {
    username: USERNAME,
    since: date(100),
  });
  assert.deepEqual(keys, ['105', '103', '100']);
});

test('comments answer their parent and are about the thread’s submission', async t => {
  const { requests } = await fakeHackerNews(t);
  const { keys, actions } = await extract(HackerNewsCommentsExtractor);

  // The deleted comment (109) is skipped.
  assert.deepEqual(keys, ['110', '107', '106']);
  assert.deepEqual(actions, [
    // Three levels down: answers Riley's 108, about Sam's story 100.
    respond(
      110,
      sam,
      comment(108, riley, 'And patience.', bread),
      comment(110, sam, 'So much patience.', bread)
    ),
    // Top level: the parent and the thread's submission are the same Post.
    respond(107, sam, trails, comment(107, sam, 'Lovely map.', trails)),
    respond(106, sam, bread, comment(106, sam, 'Thanks, all.', bread)),
  ]);

  // Every item is fetched once, however many comments share it as an ancestor.
  const items = requests.filter(path => path.startsWith('/v0/item/'));
  assert.deepEqual(items.length, new Set(items).size);
  assert.ok(items.includes('/v0/item/104.json'));
});

test('replies are other people’s comments on your submissions and comments', async t => {
  await fakeHackerNews(t);
  const { keys, actions } = await extract(HackerNewsRepliesExtractor);

  // Your own 106 on your story is a comment, not a reply. Dead 111 still happened.
  assert.deepEqual(keys, ['111', '104']);
  assert.deepEqual(actions, [
    respond(
      111,
      riley,
      comment(107, sam, 'Lovely map.', trails),
      comment(111, riley, 'Thanks!', trails)
    ),
    respond(104, alex, bread, comment(104, alex, 'Salt & time.', bread)),
  ]);
});

test('an unknown user is an input error', async t => {
  await fakeHackerNews(t);
  await assert.rejects(extract(HackerNewsSubmissionsExtractor, { username: 'nobody' }), {
    name: 'InputNotFound',
    message: 'Hacker News has no user named nobody',
  });
});
