import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findExports, monthKey, writeZip } from '@chronicle.app/etl';
import {
  FacebookArchiveMessagesExtractor,
  FacebookArchiveReactionsExtractor,
  FacebookArchiveSearchHistoryExtractor,
  FacebookTransformer,
} from '../dist/index.js';
import { T0, facebookExportFiles, writeFacebookExport } from './fixture.test-helper.js';

// The export is written to a temp dir, so the tests read no host data.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'facebook-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function records(Extractor, config) {
  const extractor = new Extractor({ limit: 0, ...config });
  try {
    await extractor.setup();
    return { extractor, records: await Array.fromAsync(extractor.extract()) };
  } finally {
    await extractor.teardown();
  }
}

async function survey(Extractor, config, options) {
  const extractor = new Extractor(config);
  try {
    await extractor.setup();
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}

async function transform(record) {
  const nodes = await new FacebookTransformer().performTransform(record);
  return nodes.map(n => n.data);
}

const iso = seconds => new Date(seconds * 1000).toISOString();
const me = { '@type': 'Agent', source: 'facebook', '@key': ['@type', 'source'], sameAs: ['@me'] };
const alex = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'name'],
  source: 'facebook',
  name: 'Alex Morgan',
};
const sam = {
  '@type': 'Agent',
  '@key': ['@type', 'source', 'name'],
  source: 'facebook',
  name: 'Sam Rivera',
};
const post = id => ({
  '@type': 'Post',
  '@key': ['@type', 'source', 'url'],
  source: 'facebook',
  url: `https://www.facebook.com/alex.morgan.example/posts/${id}`,
  author: [
    {
      '@type': 'Person',
      '@key': ['@type', 'source', 'name'],
      source: 'facebook',
      name: 'Alex Morgan',
    },
  ],
});
const accountInfo = {
  name: 'Sam Rivera',
  email: 'sam@example.com',
  username: 'sam.rivera.example',
  phone: null,
};

test('Messenger messages become schema-valid MessageActions', async t => {
  const input = writeFacebookExport(tempDir(t));
  const { records: rows } = await records(FacebookArchiveMessagesExtractor, { input });

  // message_1.json is read before message_2.json.
  assert.deepEqual(
    rows.map(r => r.data.content),
    ["Here's the map", 'No sender', 'Trail at 9?']
  );
  assert.deepEqual(rows[0].context, {
    conversationId: 'alexmorgan_1234567890',
    threadType: 'inbox',
    messageFile: true,
    strategy: 'archive',
    accountInfo,
  });
  assert.equal(rows[0].data.messageType, 'photo');

  // The export's mojibake apostrophe is repaired in the body; the recipient is
  // every participant but the sender.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'MessageAction',
      timestamp: iso(T0 + 5),
      '@assertedAt': iso(T0 + 5),
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'result.body'],
      source: 'facebook',
      agent: alex,
      result: {
        '@type': 'Message',
        '@key': ['@type', 'source', 'body', 'recipient'],
        source: 'facebook',
        body: "Here's the map",
        recipient: [sam],
      },
    },
  ]);
  // A message with no sender in a two-person thread is left out.
  assert.deepEqual(await transform(rows[1]), []);
  assert.deepEqual((await transform(rows[2]))[0].agent, sam);

  // since drops the older message.
  const since = new Date((T0 + 4.5) * 1000);
  const { records: recent } = await records(FacebookArchiveMessagesExtractor, { input, since });
  assert.deepEqual(
    recent.map(r => r.data.content),
    ["Here's the map"]
  );
});

test('reactions and comments route to their own record types and actions', async t => {
  const input = writeFacebookExport(tempDir(t));
  const { extractor, records: rows } = await records(FacebookArchiveReactionsExtractor, { input });

  assert.deepEqual(
    rows.map(r => [r.extraction.recordType, r.data.reactionType]),
    [
      ['reactions', 'like'],
      ['reactions', 'love'],
      ['reactions', 'wow'],
      ['comments', 'comment'],
    ]
  );
  // Only the label_values dialect carries Facebook's fbid.
  assert.deepEqual(
    rows.map(r => extractor.keyOf(r)),
    ['100200300', '100200301', null, null]
  );
  assert.equal(rows[0].data.targetPostId, '555000111');

  // The like button is a LikeAction on the post.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'LikeAction',
      timestamp: iso(T0),
      '@assertedAt': iso(T0),
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.url'],
      source: 'facebook',
      agent: me,
      object: post('555000111'),
    },
  ]);

  // An emotive reaction is a RespondAction whose Response keeps the export's word.
  assert.deepEqual(await transform(rows[1]), [
    {
      '@type': 'RespondAction',
      timestamp: iso(T0 + 60),
      '@assertedAt': iso(T0 + 60),
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.url', 'result.body'],
      source: 'facebook',
      agent: me,
      object: post('555000222'),
      result: {
        '@type': 'Response',
        '@key': [
          '@type',
          'source',
          'body',
          'action.timestamp',
          'action.agent.name',
          'action.object.url',
        ],
        source: 'facebook',
        body: 'love',
      },
    },
  ]);

  // The data-array dialect has no post URL. The Post's url is null, which the
  // schema rejects; this is the original plugin's behavior.
  assert.equal(rows[2].data.contentUrl, null);
  await assert.rejects(transform(rows[2]), /object/);

  // A comment is a RespondAction with a Comment result and no object.
  const owner = { ...sam, sameAs: ['@me'] };
  assert.deepEqual(await transform(rows[3]), [
    {
      '@type': 'RespondAction',
      timestamp: iso(T0 + 100),
      '@assertedAt': iso(T0 + 100),
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'result.body'],
      source: 'facebook',
      agent: owner,
      result: {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'body'],
        source: 'facebook',
        body: 'Great photo',
        author: [owner],
      },
    },
  ]);
});

test('search history becomes FindActions with the query entered', async t => {
  const input = writeFacebookExport(tempDir(t));
  const { records: rows } = await records(FacebookArchiveSearchHistoryExtractor, { input });

  // The entry with no text is left out.
  assert.equal(rows.length, 1);
  assert.equal(rows[0].extraction.recordType, 'searches');
  assert.deepEqual(rows[0].context, {
    searchType: 'facebook_search',
    dataSource: 'search_history',
    strategy: 'archive',
    accountInfo,
  });

  // The attachment's quoted query wins over the entry's text.
  assert.deepEqual(await transform(rows[0]), [
    {
      '@type': 'FindAction',
      timestamp: iso(T0 + 200),
      '@assertedAt': iso(T0 + 200),
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.body'],
      source: 'facebook',
      agent: me,
      object: {
        '@type': 'Query',
        '@key': ['@type', 'source', 'body'],
        source: 'facebook',
        body: 'trail running shoes',
      },
    },
  ]);
});

test('a segmented export is read across its facebook-* directories', async t => {
  const input = tempDir(t);
  writeFacebookExport(join(input, 'facebook-samrivera-1'));
  // A second segment repeats the same thread and reactions.
  writeFacebookExport(join(input, 'facebook-samrivera-2'));
  // Other directories are not segments.
  mkdirSync(join(input, 'other'));

  const messages = await records(FacebookArchiveMessagesExtractor, { input });
  // A conversation is read from the first segment that has it.
  assert.equal(messages.records.length, 3);
  assert.deepEqual(messages.records[0].context.accountInfo, accountInfo);

  // Reactions repeated in a later segment are read once.
  const reactions = await records(FacebookArchiveReactionsExtractor, { input });
  assert.equal(reactions.records.length, 4);

  // The limit applies across segments.
  const searches = await records(FacebookArchiveSearchHistoryExtractor, { input, limit: 1 });
  assert.equal(searches.records.length, 1);
});

// What a survey of these records should say: each kind's count and first and
// last times, and how many conversations the messages are in.
function surveyed(Extractor, rows) {
  const expected = {};
  for (const kind of Extractor.recordTypes) {
    const ofKind = rows.filter(r => r.extraction.recordType === kind);
    const times = ofKind.filter(r => r.data.timestamp).map(r => Date.parse(r.data.timestamp));
    expected[kind] = {
      count: ofKind.length,
      ...(times.length > 0 && {
        earliest: new Date(Math.min(...times)),
        latest: new Date(Math.max(...times)),
      }),
    };
  }
  if (expected.messages) {
    const conversations = new Set(rows.map(r => r.context.conversationId)).size;
    expected.messages.measures = [
      { key: 'conversations', label: 'conversations', value: conversations },
    ];
  }
  return expected;
}

test('a survey counts what a run reads, whatever its limit, and when', async t => {
  // Two segments repeat the same records, which a run and its survey read once.
  const input = tempDir(t);
  writeFacebookExport(join(input, 'facebook-samrivera-1'));
  writeFacebookExport(join(input, 'facebook-samrivera-2'));
  const since = new Date((T0 + 4.5) * 1000);
  for (const Extractor of [
    FacebookArchiveMessagesExtractor,
    FacebookArchiveReactionsExtractor,
    FacebookArchiveSearchHistoryExtractor,
  ]) {
    const { records: rows } = await records(Extractor, { input });
    assert.ok(rows.length > 0, Extractor.name);
    assert.deepEqual(
      await survey(Extractor, { input, limit: 1 }),
      surveyed(Extractor, rows),
      Extractor.name
    );

    // since drops the older records from both.
    const { records: kept } = await records(Extractor, { input, since });
    assert.deepEqual(await survey(Extractor, { input, since }), surveyed(Extractor, kept));

    // By month when asked, by the same times, in local time.
    const months = await survey(Extractor, { input }, { byMonth: true });
    for (const kind of Extractor.recordTypes) {
      const tally = {};
      for (const row of rows.filter(r => r.extraction.recordType === kind && r.data.timestamp)) {
        const month = monthKey(new Date(row.data.timestamp));
        tally[month] = (tally[month] ?? 0) + 1;
      }
      assert.deepEqual(months[kind].byMonth, tally, kind);
    }
  }
});

test('an export reads the same zipped, and its layout finds it where it starts', async t => {
  const dir = tempDir(t);
  const unzipped = writeFacebookExport(join(dir, 'facebook-samrivera-11_08_2026-AbCd'));
  const zip = join(dir, 'facebook-samrivera-11_08_2026-AbCd.zip');
  writeZip(zip, facebookExportFiles());
  for (const Extractor of [
    FacebookArchiveMessagesExtractor,
    FacebookArchiveReactionsExtractor,
    FacebookArchiveSearchHistoryExtractor,
  ]) {
    const folder = await records(Extractor, { input: unzipped });
    const zipped = await records(Extractor, { input: zip });
    assert.ok(folder.records.length > 0, Extractor.name);
    assert.deepEqual(
      zipped.records.map(r => [r.data, r.context]),
      folder.records.map(r => [r.data, r.context]),
      Extractor.name
    );
  }

  const { chronicle } = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json')));
  const { layouts } = chronicle.sources.facebook.strategies.archive;
  const { exports } = await findExports(dir, [
    { source: 'facebook', strategy: 'archive', layouts },
  ]);
  assert.deepEqual(
    exports.map(e => e.root),
    [unzipped, zip]
  );
});
