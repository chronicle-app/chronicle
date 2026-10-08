import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { GoogleReaderExtractor, GoogleReaderTransformer } from '../dist/index.js';
import { FRIEND_ID, OWNER_ID, annotation, archive, item, stream } from './fixture.test-helper.js';

const JAN_1 = new Date('2010-01-01T00:00:00Z');

function extract(input, config = {}) {
  return Array.fromAsync(new GoogleReaderExtractor({ input, ...config }).extract());
}

async function transform(records) {
  const transformer = new GoogleReaderTransformer();
  const nodes = await Promise.all(records.map(r => transformer.performTransform(r)));
  return nodes.flat().map(n => n.data);
}

/** The values an entity's `@key` paths select, as one comparable string. */
function identity(value) {
  return JSON.stringify(
    value['@key'].map(keyPath => keyPath.split('.').reduce((obj, key) => obj[key], value))
  );
}

const owner = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'google-reader',
  sourceId: OWNER_ID,
  handle: 'pat@example.com',
  name: 'Pat Example',
  sameAs: [
    {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'email',
      handle: 'pat@example.com',
      name: 'Pat Example',
    },
    // The Google account, by its address, as Gmail, Calendar, and Chrome key it.
    {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'google-account',
      handle: 'pat@example.com',
    },
    '@me',
  ],
};

// Without an address, there's no account to link.
const ownerWithoutProfile = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'google-reader',
  sourceId: OWNER_ID,
  sameAs: ['@me'],
};

test('owner states and notes become schema-valid actions on an Article', async t => {
  const input = archive(t);
  stream(input, 'reading-list', [
    {
      ...item('tag:google.com,2005:reader/item/0001'),
      title: 'Trail notes',
      categories: [
        `user/${FRIEND_ID}/state/com.google/broadcast`,
        `user/${OWNER_ID}/state/com.google/read`,
        `user/${OWNER_ID}/state/com.google/broadcast`,
        `user/${OWNER_ID}/state/com.google/starred`,
      ],
      summary: { content: '<p>Summary</p>' },
      content: { content: '<p>Full text</p>' },
      annotations: [annotation('Worth a hike'), annotation("A friend's note", FRIEND_ID)],
    },
    { ...item('friend-only'), categories: [`user/${FRIEND_ID}/state/com.google/read`] },
  ]);

  const records = await extract(input);
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.extraction.recordType, 'stream-contents');
  assert.equal(record.extraction.source, 'google-reader');
  // The record carries stream metadata, not the whole stream.
  assert.deepEqual(record.data.streamData, { id: 'reading-list', title: 'reading-list' });
  assert.equal(record.data.item.id, 'tag:google.com,2005:reader/item/0001');

  const actions = await transform(records);
  assert.deepEqual(
    actions.map(a => a['@type']),
    ['ReadAction', 'PublishAction', 'LikeAction', 'AnnotateAction']
  );

  const article = {
    '@type': 'Article',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'google-reader',
    sourceId: 'tag:google.com,2005:reader/item/0001',
    url: 'https://example.com/tag:google.com,2005:reader/item/0001',
    name: 'Trail notes',
    body: '<p>Full text</p>',
  };
  assert.deepEqual(actions[0], {
    '@type': 'ReadAction',
    '@key': ['@type', 'source', 'sourceId', 'agent.sourceId'],
    source: 'google-reader',
    sourceId: 'tag:google.com,2005:reader/item/0001',
    timestamp: JAN_1,
    '@assertedAt': JAN_1,
    agent: owner,
    object: article,
  });
  for (const action of actions.slice(1, 3)) {
    assert.deepEqual(action, { ...actions[0], '@type': action['@type'] });
  }
  assert.deepEqual(actions[3], {
    '@type': 'AnnotateAction',
    '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId', 'result.body'],
    source: 'google-reader',
    timestamp: JAN_1,
    '@assertedAt': JAN_1,
    agent: owner,
    object: article,
    result: {
      '@type': 'Comment',
      '@key': ['@type', 'source', 'body', 'about.0.sourceId', 'author.0.sourceId'],
      source: 'google-reader',
      body: 'Worth a hike',
      author: [owner],
      about: [article],
    },
  });
});

test('the owner has no email identity or name without matching user info', async t => {
  // Reader archive field names.
  /* eslint-disable camelcase */
  const blankEmails = [undefined, '', '   '].map(email => ({ user_id: OWNER_ID, email }));
  const otherUser = { user_id: FRIEND_ID, email: 'alex@example.com', user_name: 'Alex Example' };
  /* eslint-enable camelcase */

  const agents = async (userInfo, config) => {
    const input = archive(t, userInfo);
    stream(input, 'a', [item('one')]);
    const [action] = await transform(await extract(input, config));
    return action.agent;
  };
  // A blank email adds no email identity.
  for (const agent of await Promise.all(blankEmails.map(info => agents(info)))) {
    assert.deepEqual(agent, ownerWithoutProfile);
  }
  // Missing or someone else's user info lends no profile to an explicit owner.
  for (const agent of await Promise.all(
    [null, otherUser].map(info => agents(info, { userId: OWNER_ID }))
  )) {
    assert.deepEqual(agent, ownerWithoutProfile);
  }
});

test('an explicit owner is required when user info is missing, and selects stream files', async t => {
  const input = archive(t, null);
  stream(input, 'a', [item('mine')]);
  stream(
    input,
    'a',
    [{ ...item('theirs'), categories: [`user/${FRIEND_ID}/state/com.google/read`] }],
    FRIEND_ID
  );
  await assert.rejects(extract(input), /--user-id/);
  assert.deepEqual(
    (await extract(input, { userId: OWNER_ID })).map(r => r.data.item.id),
    ['mine']
  );
  assert.deepEqual(
    (await extract(input, { userId: FRIEND_ID })).map(r => r.data.item.id),
    ['theirs']
  );
});

test('limit caps items across files in filename order; zero is unlimited', async t => {
  const input = archive(t);
  stream(input, 'b', [item('b1'), item('b2'), item('b3')]);
  stream(input, 'a', [item('a1'), item('a2'), item('a3')]);
  assert.deepEqual(
    (await extract(input, { limit: 4 })).map(r => r.data.item.id),
    ['a1', 'a2', 'a3', 'b1']
  );
  assert.equal((await extract(input, { limit: 0 })).length, 6);
  assert.equal(await new GoogleReaderExtractor({ input, limit: 3 }).determineCount(), 3);
});

test('since and until are inclusive and apply before the limit', async t => {
  const input = archive(t);
  stream(input, 'a', [
    item('old', '1262303999000000'),
    item('start'),
    item('end', '1262304001000000'),
    item('new', '1262304002000000'),
  ]);
  const since = new Date('2010-01-01T00:00:00Z');
  const until = new Date('2010-01-01T00:00:01Z');
  assert.deepEqual(
    (await extract(input, { since, until, limit: 2 })).map(r => r.data.item.id),
    ['start', 'end']
  );
  assert.equal((await extract(input, { since: new Date('2024-01-01') })).length, 0);
});

test('notes stay distinct across text and articles; URL-less articles stay distinct', async t => {
  const input = archive(t);
  stream(input, 'a', [
    {
      ...item('one'),
      categories: [],
      annotations: [annotation('Same note'), annotation('Another note')],
    },
    { ...item('two'), categories: [], annotations: [annotation('Same note')] },
    { ...item('three'), alternate: undefined },
    { ...item('four'), alternate: undefined },
  ]);
  const actions = await transform(await extract(input));
  const notes = actions.filter(a => a['@type'] === 'AnnotateAction');
  assert.equal(notes.length, 3);
  assert.equal(new Set(notes.map(a => identity(a))).size, 3);
  assert.equal(new Set(notes.map(a => identity(a.result))).size, 3);

  const reads = actions.filter(a => a['@type'] === 'ReadAction');
  assert.deepEqual(
    reads.map(a => a.object.url),
    [undefined, undefined]
  );
  assert.equal(new Set(reads.map(a => identity(a.object))).size, 2);
  // Keys are stable across runs.
  assert.deepEqual(
    (await transform(await extract(input))).map(a => identity(a)),
    actions.map(a => identity(a))
  );
});

test('a malformed stream fails the extraction', async t => {
  const input = archive(t);
  stream(input, 'a', [item('one')]);
  stream(input, 'broken', '{');
  await assert.rejects(extract(input), /Failed to process Google Reader archive/);

  rmSync(
    join(
      input,
      '_raw_data',
      `www.google.com-reader-api-0-stream-contents-user-${OWNER_ID}-broken.json`
    )
  );
  stream(input, 'bad-time', [item('bad', 'not-a-number')]);
  await assert.rejects(extract(input), /Invalid timestampUsec/);
});
