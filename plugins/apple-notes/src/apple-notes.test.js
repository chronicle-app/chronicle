import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AppleNotesEditsExtractor,
  AppleNotesExtractor,
  AppleNotesTransformer,
} from '../dist/index.js';
import { NOON, writeNotesFixture } from './fixture.test-helper.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-notes-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, input: writeNotesFixture(dir) };
}

/** What a record type becomes, in the order the extractor gives it, with when it was read. */
async function payloads(Extractor, config) {
  const extractor = new Extractor({ limit: 0, ...config });
  const transformer = new AppleNotesTransformer();
  const out = [];
  try {
    await extractor.setup();
    for await (const record of extractor.extract())
      for (const node of await transformer.performTransform(record))
        out.push({ readAt: record.extraction.assertedAt, data: node.data });
  } finally {
    await extractor.teardown();
  }
  return out;
}

/** What a record type's nodes say, in the order the extractor gives them. */
async function nodes(Extractor, config) {
  return (await payloads(Extractor, config)).map(({ data }) => withoutDirectives(data));
}

// A snapshot source asserts every node complete at read time; the tests look
// at what the nodes say.
function withoutDirectives(node) {
  if (Array.isArray(node)) return node.map(item => withoutDirectives(item));
  if (!node || typeof node !== 'object' || node instanceof Date) return node;
  const { '@asserts': _asserts, '@assertedAt': _assertedAt, ...rest } = node;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, withoutDirectives(v)]));
}

const key = ['@type', 'source', 'sourceId'];
const identity = (source, handle) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source,
  handle,
});
// You, by your CloudKit user ID in Notes, with the name and contacts a share lists.
const pat = {
  '@type': 'Person',
  '@key': key,
  source: 'apple-notes',
  sourceId: '_you',
  name: 'Pat Doe',
  sameAs: [identity('email', 'pat@example.com'), identity('phone', '+16135550100'), '@me'],
};
// Sam, linked by email and phone to the same person in other sources.
const sam = {
  '@type': 'Person',
  '@key': key,
  source: 'apple-notes',
  sourceId: '_sam',
  name: 'Sam Rivera',
  sameAs: [identity('email', 'sam@example.com'), identity('phone', '+16135550142')],
};
const note = (sourceId, name) => ({
  '@type': 'Note',
  '@key': key,
  source: 'apple-notes',
  sourceId,
  name,
});
const folder = (sourceId, name) => ({
  '@type': 'Collection',
  '@key': key,
  source: 'apple-notes',
  sourceId,
  name,
});
const at = seconds => new Date((NOON + seconds) * 1000);

test('each note is a CreateAction by whoever made it, newest first', async t => {
  const { dir, input } = fixture(t);
  const actions = await nodes(AppleNotesExtractor, { input });

  assert.deepEqual(
    actions.map(action => action.sourceId),
    ['NOTE-SOUP', 'NOTE-GARDEN', 'NOTE-LOCKED', 'NOTE-OLD'],
    'the note marked for deletion is left out'
  );
  const [soup, garden, locked, old] = actions;

  assert.deepEqual(garden, {
    '@type': 'CreateAction',
    '@key': key,
    source: 'apple-notes',
    sourceId: 'NOTE-GARDEN',
    timestamp: at(-60),
    agent: pat,
    result: {
      ...note('NOTE-GARDEN', 'Garden plan'),
      body: [
        '# Garden plan',
        'Order **seeds** from [the catalog](https://seeds.example.com)',
        '- [x] Tomatoes, cherry',
        '- [ ] Basil',
        '[image: seedlings.jpeg]',
        'See #garden',
      ].join('\n'),
      tags: ['garden'],
      isPartOf: [folder('FOLDER-NOTES', 'Notes')],
      contains: [
        {
          '@type': 'ImageObject',
          '@key': key,
          source: 'apple-notes',
          sourceId: 'IMAGE-1',
          contentPath: join(dir, 'Accounts/ACCOUNT-1/Media/MEDIA-1/GENERATION-1/seedlings.jpeg'),
        },
      ],
    },
  });

  // Made by Sam in Sam's folder. A table isn't a file, so the note contains nothing.
  assert.deepEqual(soup.agent, sam);
  assert.equal(soup.result.body, '# Soup\nCarrots, leeks\n[table]\nMore salt\nBay leaf');
  assert.deepEqual(soup.result.isPartOf, [folder('FOLDER-KITCHEN', 'Kitchen')]);
  assert.equal(soup.result.contains, undefined);

  // A locked note's text can't be read; a note never synced was made here.
  assert.equal(locked.result.body, undefined);
  assert.deepEqual(locked.agent, pat);
  assert.deepEqual(old.agent, pat);
  assert.equal(old.result.body, '# Old list\n- Milk');
});

test("each person's writing is its own edit, with the text from it that's still there", async t => {
  const { input } = fixture(t);
  const edits = await nodes(AppleNotesEditsExtractor, { input });

  const summary = edits.map(edit => ({
    note: edit.object.sourceId,
    by: edit.agent?.sourceId ?? null,
    start: edit.startTime,
    end: edit.endTime,
    text: edit.result.body,
  }));
  assert.deepEqual(summary, [
    // A replica the note doesn't map to anyone: no agent.
    {
      note: 'NOTE-SOUP',
      by: null,
      start: at(86_900),
      end: at(86_900),
      text: 'Bay leaf',
    },
    {
      note: 'NOTE-SOUP',
      by: '_you',
      start: at(86_800),
      end: at(86_800),
      text: 'More salt',
    },
    {
      note: 'NOTE-SOUP',
      by: '_sam',
      start: at(86_400),
      end: at(86_440),
      text: '# Soup\nCarrots, leeks\n[table]',
    },
    {
      note: 'NOTE-GARDEN',
      by: '_you',
      start: at(3 * 3600),
      end: at(3 * 3600 + 30),
      text: '[image: seedlings.jpeg]\nSee #garden',
    },
    // Sam wrote while you were writing, and it's Sam's own edit. Sam's words at
    // the end of your item aren't an item of their own.
    {
      note: 'NOTE-GARDEN',
      by: '_sam',
      start: at(240),
      end: at(240),
      text: ', cherry\n…\n- [ ] Basil',
    },
    {
      note: 'NOTE-GARDEN',
      by: '_you',
      start: at(0),
      end: at(120),
      text: '# Garden plan\nOrder **seeds** from [the catalog](https://seeds.example.com)\n- [x] Tomatoes',
    },
  ]);

  const samsEdit = edits.find(
    edit => edit.agent?.sourceId === '_sam' && edit.object.sourceId === 'NOTE-GARDEN'
  );
  assert.deepEqual(samsEdit, {
    '@type': 'UpdateAction',
    '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId', 'startTime'],
    source: 'apple-notes',
    startTime: at(240),
    endTime: at(240),
    agent: sam,
    object: note('NOTE-GARDEN', 'Garden plan'),
    result: {
      '@type': 'Changeset',
      '@key': [
        '@type',
        'source',
        'action.object.sourceId',
        'action.agent.sourceId',
        'action.startTime',
      ],
      source: 'apple-notes',
      body: ', cherry\n…\n- [ ] Basil',
      isPartOf: [note('NOTE-GARDEN', 'Garden plan')],
    },
  });
  // The note's title and text in an edit are as of the read, not the burst.
  for (const { readAt, data } of await payloads(AppleNotesEditsExtractor, { input }))
    assert.equal(data['@assertedAt'], readAt);
  assert.equal(
    edits.find(edit => edit.object.sourceId === 'NOTE-LOCKED'),
    undefined
  );
  assert.equal(
    edits.find(edit => edit.object.sourceId === 'NOTE-OLD'),
    undefined
  );
});

test('edits are bounded by when they ended, and the session gap splits them', async t => {
  const { input } = fixture(t);
  const ends = async config =>
    (await nodes(AppleNotesEditsExtractor, { input, ...config })).map(edit =>
      edit.endTime.toISOString()
    );

  assert.deepEqual(
    await ends({ limit: 2 }),
    [at(86_900), at(86_800)].map(d => d.toISOString())
  );
  assert.deepEqual(
    await ends({ since: at(200), until: at(86_400) }),
    [at(3 * 3600 + 30), at(240)].map(d => d.toISOString())
  );

  // Your first session wrote a minute apart; a 30-second gap splits it in three.
  const garden = (await nodes(AppleNotesEditsExtractor, { input, sessionGap: 0.5 })).filter(
    edit => edit.object.sourceId === 'NOTE-GARDEN' && edit.agent?.sourceId === '_you'
  );
  assert.deepEqual(
    garden.map(edit => edit.result.body),
    [
      '[image: seedlings.jpeg]\nSee #garden',
      '- [x] Tomatoes',
      'Order **seeds** from [the catalog](https://seeds.example.com)',
      '# Garden plan',
    ]
  );
});
