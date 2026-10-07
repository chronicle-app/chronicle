import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EmailMboxExtractor, EmailTransformer } from '../dist/index.js';

// The mbox is synthetic and every address is made up; the tests read nothing
// from the host's mail.
const DELIM = '\u001F';
const ALICE = 'Alice Example <alice@example.test>';
const CAROL = 'Carol <carol@example.test>';
const KEYED_DATE = 'Mon, 6 Jan 2025 10:00:00 +0000';
const KEYLESS_DATE = 'Mon, 6 Jan 2025 11:00:00 +0000';
const KEYLESS_ISO = '2025-01-06T11:00:00.000Z';
const CAROL_ADDRESS = 'carol@example.test';

/** Render message specs as one mbox; an omitted field omits its header. */
function mbox(specs) {
  return specs
    .map(s =>
      [
        'From sender@example.test Mon Jan  6 10:00:00 2025',
        ...(s.from === undefined ? [] : [`From: ${s.from}`]),
        `To: ${s.to ?? 'bob@example.test'}`,
        ...(s.cc === undefined ? [] : [`Cc: ${s.cc}`]),
        ...(s.subject === undefined ? [] : [`Subject: ${s.subject}`]),
        ...(s.date === undefined ? [] : [`Date: ${s.date}`]),
        ...(s.messageId === undefined ? [] : [`Message-ID: ${s.messageId}`]),
        ...(s.headers ?? []),
        '',
        s.body,
        '',
      ].join('\n')
    )
    .join('\n');
}

const keyed = {
  from: ALICE,
  to: 'Bob <bob@example.test>, dana@example.test',
  cc: 'Erin <erin@example.test>',
  // RFC 2047 encoded words are decoded.
  subject: '=?UTF-8?Q?Caf=C3=A9_plans?=',
  date: KEYED_DATE,
  messageId: '<keyed-1@example.test>',
  headers: ['MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"'],
  body: [
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Lunch at noon?',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Lunch at noon?</p>',
    '--b1--',
  ].join('\n'),
};
const keyless = {
  from: CAROL,
  subject: 'Keyless',
  date: KEYLESS_DATE,
  body: 'No Message-ID header.',
};

function fixture(t, specs) {
  const dir = mkdtempSync(join(tmpdir(), 'email-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'mail.mbox');
  writeFileSync(input, mbox(specs));
  return input;
}

async function extract(input, config = {}) {
  const extractor = new EmailMboxExtractor({ input, quiet: true, ...config });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    return { extractor, records };
  } finally {
    await extractor.teardown();
  }
}

async function transform(records) {
  const transformer = new EmailTransformer();
  const out = [];
  for (const record of records) {
    for (const node of await transformer.performTransform(record)) out.push(node.data);
  }
  return out;
}

// People and messages are keyed with no source: an address, or a Message-ID,
// is the same wherever it's read.
const agent = (handle, name) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source: 'email',
  handle,
  name: name ?? handle,
});

test('messages become schema-valid MessageActions keyed on the Message-ID', async t => {
  const input = fixture(t, [keyed]);
  const { extractor, records } = await extract(input);
  assert.equal(records.length, 1);
  assert.equal(extractor.keyOf(records[0]), '<keyed-1@example.test>');

  const [action] = await transform(records);
  const alice = agent('alice@example.test', 'Alice Example');
  assert.deepEqual(action, {
    '@type': 'MessageAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'email',
    // The Message-ID, without its angle brackets.
    sourceId: 'keyed-1@example.test',
    timestamp: new Date('2025-01-06T10:00:00Z'),
    '@assertedAt': new Date('2025-01-06T10:00:00Z'),
    agent: alice,
    object: {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'email',
      sourceId: 'keyed-1@example.test',
      name: 'Café plans',
      // The text/plain alternative; the HTML one is left out.
      body: 'Lunch at noon?',
      author: [alice],
      recipient: [
        agent('bob@example.test', 'Bob'),
        agent('dana@example.test'),
        agent('erin@example.test', 'Erin'),
      ],
    },
  });
});

test('a message without a Message-ID is keyed on From, Date, and Subject', async t => {
  const input = fixture(t, [
    keyed,
    keyless,
    { ...keyless, subject: 'Keyless, but another' },
    keyless,
    { ...keyless, subject: '' },
  ]);
  const first = await extract(input);
  const keys = first.records.map(r => first.extractor.keyOf(r));
  assert.deepEqual(keys, [
    '<keyed-1@example.test>',
    [CAROL_ADDRESS, KEYLESS_ISO, 'Keyless'].join(DELIM),
    [CAROL_ADDRESS, KEYLESS_ISO, 'Keyless, but another'].join(DELIM),
    [CAROL_ADDRESS, KEYLESS_ISO, 'Keyless'].join(DELIM),
    // An empty Subject still takes part.
    [CAROL_ADDRESS, KEYLESS_ISO, ''].join(DELIM),
  ]);
  // A second run over the same file agrees exactly.
  const second = await extract(input);
  assert.deepEqual(
    second.records.map(r => second.extractor.keyOf(r)),
    keys
  );

  const [, action] = await transform(first.records);
  const carol = agent('carol@example.test', 'Carol');
  assert.deepEqual(action, {
    '@type': 'MessageAction',
    '@key': ['@type', 'source', 'timestamp', 'agent.handle', 'object.name'],
    source: 'email',
    timestamp: new Date('2025-01-06T11:00:00Z'),
    '@assertedAt': new Date('2025-01-06T11:00:00Z'),
    agent: carol,
    object: {
      '@type': 'Message',
      '@key': ['@type', 'source', 'action.timestamp', 'action.agent.handle', 'name'],
      source: 'email',
      name: 'Keyless',
      body: 'No Message-ID header.',
      author: [carol],
      recipient: [agent('bob@example.test')],
    },
  });
});

test('a message without a usable Date takes its From line’s; one with no sender is skipped', async t => {
  const input = fixture(t, [
    keyed,
    { ...keyless, from: undefined },
    { ...keyless, date: undefined },
    { ...keyless, date: 'not a date' },
  ]);
  const extractor = new EmailMboxExtractor({ input, quiet: true });
  const warnings = [];
  extractor.logger.warn = message => warnings.push(message);
  const records = await Array.fromAsync(extractor.extract());
  // The fixture's From lines say Mon Jan  6 10:00:00 2025, read as UTC.
  assert.deepEqual(
    records.map(r => [r.data.subject, r.data.date]),
    [
      ['Café plans', '2025-01-06T10:00:00.000Z'],
      ['Keyless', '2025-01-06T10:00:00.000Z'],
      ['Keyless', '2025-01-06T10:00:00.000Z'],
    ]
  );
  assert.deepEqual(warnings, [
    'Skipped 1 message(s) with no Message-ID and no From + Date to key on',
  ]);
});

test('the transformer refuses a record with no date to time it by', async () => {
  // The extractor never emits such a record; build one by hand.
  const transformer = new EmailTransformer();
  const record = {
    extraction: { source: 'email', recordType: 'emails' },
    context: { strategy: 'mbox' },
    data: {
      messageId: null,
      date: null,
      subject: 'Keyless',
      from: { address: 'carol@example.test', name: 'Carol' },
      to: [],
      cc: [],
      bcc: [],
      inReplyTo: null,
      references: [],
      text: '',
      attachments: [],
      headers: {},
    },
  };
  await assert.rejects(transformer.transform(record), /has no date/);
});
