import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SlackExtractor, SlackTransformer } from '../dist/index.js';
import { writeSlackFixture } from './fixture.test-helper.js';

function exportDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'slack-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return writeSlackFixture(dir);
}

async function actions(config) {
  const extractor = new SlackExtractor(config);
  await extractor.setup();
  const records = await Array.fromAsync(extractor.extract());
  const transformer = new SlackTransformer();
  const out = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) out.push(node.data);
  }
  return out;
}

const key = ['@type', 'source', 'sourceId'];
const workspace = { '@type': 'Realm', '@key': key, source: 'slack', sourceId: 'T1' };
const agent = (sourceId, handle, name) => ({
  '@type': 'Agent',
  '@key': key,
  source: 'slack',
  sourceId,
  ...(handle && { handle }),
  ...(name && { name }),
  memberOf: [workspace],
});
const alex = agent('U1', 'alex', 'Alex');
const sam = agent('U2', 'sam', 'Sam Lee');
// users.json has no username for U3; the group DM's purpose supplies it.
const riley = agent('U3', 'riley', 'riley');

function messageAction(iso, sender, body, extra = {}) {
  // The transformer writes the timestamp as a Date.
  const timestamp = new Date(iso);
  return {
    '@type': 'MessageAction',
    '@key': ['@type', 'source', 'timestamp', 'agent'],
    source: 'slack',
    timestamp,
    '@assertedAt': timestamp,
    agent: sender,
    object: {
      '@type': 'Message',
      '@key': ['@type', 'source', 'body', 'author'],
      source: 'slack',
      body,
      author: [sender],
      ...extra,
    },
  };
}

test('messages across conversations become MessageActions, newest first', async t => {
  const input = exportDir(t);
  const out = await actions({ input });

  // The channel_join notice is left out; the merge across conversations is
  // globally newest-first.
  assert.deepEqual(
    out.map(a => a.object.body),
    [
      'Deploy finished',
      'Hi from a guest',
      'Trail is open',
      'Photos from the hike',
      'See you there',
      'Morning, everyone',
    ]
  );

  const byBody = new Map(out.map(a => [a.object.body, a]));
  // A public channel is a broadcast: no recipients.
  assert.deepEqual(
    byBody.get('Morning, everyone'),
    messageAction('2024-01-01T09:00:00.000Z', alex, 'Morning, everyone')
  );
  // A bot message is authored by its bot id.
  const bot = agent('B1');
  assert.deepEqual(
    byBody.get('Deploy finished'),
    messageAction('2024-01-02T08:00:00.000Z', bot, 'Deploy finished')
  );
  // A user missing from users.json resolves from the message's user_profile.
  assert.deepEqual(
    byBody.get('Hi from a guest'),
    messageAction(
      '2024-01-01T13:00:00.000Z',
      agent('U4', 'jordan', 'Jordan Kim'),
      'Hi from a guest'
    )
  );
  // A small private channel addresses its other members.
  assert.deepEqual(
    byBody.get('Trail is open'),
    messageAction('2024-01-01T12:00:00.000Z', sam, 'Trail is open', { recipient: [alex] })
  );
  // A group DM addresses every other member.
  assert.deepEqual(
    byBody.get('See you there'),
    messageAction('2024-01-01T10:00:00.000Z', riley, 'See you there', { recipient: [alex, sam] })
  );
  // A DM addresses the other person; attachments are off by default.
  assert.deepEqual(
    byBody.get('Photos from the hike'),
    messageAction('2024-01-01T11:00:00.000Z', alex, 'Photos from the hike', { recipient: [sam] })
  );
});

test('attachments are included when enabled, with a contentPath only for downloaded files', async t => {
  const input = exportDir(t);
  const out = await actions({ input, attachments: true });
  const dm = out.find(a => a.object.body === 'Photos from the hike');
  assert.deepEqual(
    dm,
    messageAction('2024-01-01T11:00:00.000Z', alex, 'Photos from the hike', {
      recipient: [sam],
      contains: [
        {
          '@type': 'ImageObject',
          '@key': key,
          contentPath: join(input, 'D1', 'attachments', 'F1-summit.png'),
          mimeType: 'image/png',
          source: 'slack',
          sourceId: 'F1',
          name: 'summit.png',
          width: 800,
          height: 600,
        },
        {
          '@type': 'DocumentObject',
          '@key': key,
          mimeType: 'application/pdf',
          source: 'slack',
          sourceId: 'F2',
          name: 'map.pdf',
        },
      ],
    })
  );
});

test('since, until, and limit bound the extraction', async t => {
  const input = exportDir(t);
  const bodies = async config => (await actions({ input, ...config })).map(a => a.object.body);

  // Both boundaries are inclusive.
  assert.deepEqual(
    await bodies({
      since: new Date('2024-01-01T10:00:00Z'),
      until: new Date('2024-01-01T12:00:00Z'),
    }),
    ['Trail is open', 'Photos from the hike', 'See you there']
  );
  // The limit applies to the merged stream: the single latest message.
  assert.deepEqual(await bodies({ limit: 1 }), ['Deploy finished']);

  const extractor = new SlackExtractor({ input });
  await extractor.setup();
  assert.equal(await extractor.determineCount(), 6);
});
