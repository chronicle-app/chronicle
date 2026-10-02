import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { PinboardExtractor, PinboardTransformer } from '../dist/index.js';

// Credentials resolve from an empty config directory, never the host's.
const configDir = mkdtempSync(join(tmpdir(), 'pinboard-config-'));
process.env.CHRONICLE_CONFIG_DIR = configDir;

const TOKEN = 'pat:0123456789ABCDEF';

const posts = [
  {
    href: 'https://trees.example.org/urban-guide',
    description: 'A guide to urban trees',
    extended: 'Read before planting season.',
    meta: 'm1',
    hash: 'hash-trees',
    time: '2025-01-03T10:00:00Z',
    shared: 'yes',
    toread: 'no',
    tags: 'trees  gardening',
  },
  {
    href: 'https://news.example.org/story',
    description: '',
    extended: '   ',
    meta: 'm2',
    hash: 'hash-story',
    time: '2025-01-02T10:00:00Z',
    shared: 'no',
    toread: 'yes',
    tags: '',
  },
  {
    href: 'https://social.example.org/post/1',
    description: 'A favourited post',
    extended: '',
    meta: 'm3',
    hash: 'hash-fav',
    time: '2025-01-01T10:00:00Z',
    shared: 'yes',
    toread: 'no',
    tags: 'twitterfavs',
  },
];

// A local stand-in for api.pinboard.in: it records each request and serves the
// posts above.
const requests = [];
let server;
let baseURL;
before(async () => {
  server = createServer((req, res) => {
    requests.push(new URL(req.url, 'http://127.0.0.1'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(posts));
  });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(configDir, { recursive: true, force: true });
});

// Points the proxy at the local server instead of api.pinboard.in.
class LocalPinboardExtractor extends PinboardExtractor {
  async setup() {
    await super.setup();
    this.proxy.client.defaults.baseURL = baseURL;
  }
}

async function run(config) {
  const extractor = new LocalPinboardExtractor({ apiKey: TOKEN, limit: 0, ...config });
  await extractor.setup();
  const records = await Array.fromAsync(extractor.extract());
  const transformer = new PinboardTransformer();
  const out = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) out.push(node.data);
  }
  return { records, actions: out };
}

const pat = {
  '@type': 'Person',
  '@key': ['@type', 'source', 'handle'],
  source: 'pinboard',
  handle: 'pat',
  name: 'pat',
  url: 'https://pinboard.in/u:pat/',
  sameAs: ['@me'],
  '@asserts': ['*'],
};
const tag = handle => ({
  '@type': 'Tag',
  '@key': ['@type', 'source', 'handle'],
  source: 'pinboard',
  handle,
  '@asserts': ['*'],
});

test('bookmarks become schema-valid BookmarkActions', async () => {
  requests.length = 0;
  const { records, actions } = await run({});

  // The token goes in the query string, and the blacklisted tag is skipped.
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/v1/posts/all');
  assert.equal(requests[0].searchParams.get('auth_token'), TOKEN);
  assert.equal(requests[0].searchParams.get('format'), 'json');
  assert.equal(requests[0].searchParams.get('meta'), 'yes');
  assert.deepEqual(
    actions.map(a => a.sourceId),
    ['hash-trees', 'hash-story']
  );

  const { assertedAt } = records[0].extraction;
  assert.ok(assertedAt);
  assert.deepEqual(actions[0], {
    '@type': 'BookmarkAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'pinboard',
    sourceId: 'hash-trees',
    timestamp: new Date('2025-01-03T10:00:00Z'),
    '@assertedAt': assertedAt,
    '@asserts': ['*'],
    agent: pat,
    object: {
      '@type': 'Entity',
      '@key': ['url', 'source'],
      source: 'pinboard',
      url: 'https://trees.example.org/urban-guide',
      name: 'A guide to urban trees',
      description: 'Read before planting season.',
      about: [tag('trees'), tag('gardening')],
      '@asserts': ['description', 'about', '*'],
    },
  });

  // Empty title, note, and tags are left out, but the page still asserts
  // `description` and `about` so a later re-read closes the old values.
  assert.deepEqual(actions[1].object, {
    '@type': 'Entity',
    '@key': ['url', 'source'],
    source: 'pinboard',
    url: 'https://news.example.org/story',
    '@asserts': ['description', 'about', '*'],
  });
});

test('date range, tag blacklist, and limit filter the posts', async () => {
  requests.length = 0;
  const since = new Date('2025-01-02T00:00:00Z');
  const { actions } = await run({ since, tagBlacklist: [] });
  assert.equal(requests[0].searchParams.get('fromdt'), since.toISOString());
  assert.deepEqual(
    actions.map(a => a.sourceId),
    ['hash-trees', 'hash-story']
  );

  const all = await run({ tagBlacklist: [] });
  assert.deepEqual(
    all.actions.map(a => a.sourceId),
    ['hash-trees', 'hash-story', 'hash-fav']
  );

  const limited = await run({ limit: 1 });
  assert.deepEqual(
    limited.actions.map(a => a.sourceId),
    ['hash-trees']
  );
});

test('a missing token fails before any request, pointing at `auth set`', async () => {
  requests.length = 0;
  const extractor = new LocalPinboardExtractor({});
  // Pinboard takes a static token, not OAuth, so the next step is `auth set`.
  await assert.rejects(extractor.setup(), {
    message: /Pinboard API key is required/,
    hint: /chronicle auth set pinboard/,
  });
  assert.equal(requests.length, 0);
});
