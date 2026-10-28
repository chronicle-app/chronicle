import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExports, monthKey, writeZip } from '@chronicle.app/etl';
import { SlackExtractor, SlackTransformer } from '../dist/index.js';
import { slackFixtureFiles, writeSlackFixture } from './fixture.test-helper.js';

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
    result: {
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
    out.map(a => a.result.body),
    [
      'Deploy finished',
      'Hi from a guest',
      'Trail is open',
      'Photos from the hike',
      'See you there',
      'Morning, everyone',
    ]
  );

  const byBody = new Map(out.map(a => [a.result.body, a]));
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
  const dm = out.find(a => a.result.body === 'Photos from the hike');
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
  const bodies = async config => (await actions({ input, ...config })).map(a => a.result.body);

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

/** Run an extractor with this config, and hand back what `use` makes of it. */
async function withExtractor(config, use) {
  const extractor = new SlackExtractor(config);
  try {
    await extractor.setup();
    return await use(extractor);
  } finally {
    await extractor.teardown();
  }
}

test('a survey counts the messages a run reads, whatever its limit, when, and in how many conversations', async t => {
  const input = exportDir(t);
  // When each message a run extracts was sent, as a run dates it.
  const sent = config =>
    withExtractor({ input, ...config }, async extractor =>
      (await Array.fromAsync(extractor.extract())).map(
        record => new Date(Number.parseFloat(record.data.message.ts) * 1000)
      )
    );
  const survey = (config, options) =>
    withExtractor({ input, ...config }, extractor => extractor.survey(options));
  const surveyed = (times, conversations) => ({
    messages: {
      count: times.length,
      earliest: new Date(Math.min(...times)),
      latest: new Date(Math.max(...times)),
      measures: [{ key: 'conversations', label: 'conversations', value: conversations }],
    },
  });

  // Every message in general, hiking, the DM, and the group DM.
  const times = await sent();
  assert.deepEqual(await survey({ limit: 1 }), surveyed(times, 4));
  // By month when asked, by when each was sent, in local time.
  const months = {};
  for (const time of times) months[monthKey(time)] = (months[monthKey(time)] ?? 0) + 1;
  assert.deepEqual((await survey({}, { byMonth: true })).messages.byMonth, months);
  // Since noon: hiking's message, then general's guest and bot.
  const since = new Date('2024-01-01T12:00:00Z');
  const kept = await sent({ since });
  assert.equal(kept.length, 3);
  assert.deepEqual(await survey({ since }), surveyed(kept, 2));
  // A run's progress counts the same, up to its limit.
  assert.equal(await withExtractor({ input, since }, e => e.determineCount()), 3);
  assert.equal(await withExtractor({ input, limit: 2 }, e => e.determineCount()), 2);
});

/**
 * A run's actions with attachments, each `contentPath` as its bytes and its
 * path from the export, read while the run still has a zip's copies.
 */
async function readExport(input) {
  const extractor = new SlackExtractor({ input, attachments: true });
  try {
    await extractor.setup();
    const transformer = new SlackTransformer();
    const out = [];
    for (const record of await Array.fromAsync(extractor.extract())) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
    const read = (key, value) =>
      key === 'contentPath'
        ? `${readFileSync(value, 'utf8')} at ${value.split('/').slice(-3).join('/')}`
        : value;
    return JSON.parse(JSON.stringify(out, read));
  } finally {
    await extractor.teardown();
  }
}

test('an export reads the same zipped, attachments too, and its layout finds it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'slack-zip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const unzipped = writeSlackFixture(join(dir, 'slackdump_20240101_120000'));
  const zip = join(dir, 'slackdump_20240101_120000.zip');
  writeZip(zip, slackFixtureFiles());
  const folder = await readExport(unzipped);
  assert.match(JSON.stringify(folder), /"PNG at D1\/attachments\/F1-summit\.png"/);
  assert.deepEqual(await readExport(zip), folder);

  const { chronicle } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json')));
  const { layouts } = chronicle.sources.slack.strategies.archive;
  const { exports } = await findExports(dir, [{ source: 'slack', strategy: 'archive', layouts }]);
  assert.deepEqual(
    exports.map(e => e.root),
    [unzipped, zip]
  );
});
