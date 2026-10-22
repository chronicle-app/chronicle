import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeKey } from '@chronicle.app/schema';
import {
  AppleNotesEditsExtractor,
  AppleNotesExtractor,
  AppleNotesTransformer,
} from '../dist/index.js';
import {
  ACCOUNT,
  NOON,
  REPLICA,
  lookupContact,
  noteData,
  writeNotesFixture,
} from './fixture.test-helper.js';

/** The garden note's photo, as its body shows it: an image of the identity its node in `contains` has. */
const seedlings = `![seedlings.jpeg](cid:${nodeKey({
  '@type': 'ImageObject',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'apple-notes',
  sourceId: 'IMAGE-1',
})})`;
/** Its drawing, an image as its photo is. */
const sketch = `![drawing](cid:${nodeKey({
  '@type': 'ImageObject',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'apple-notes',
  sourceId: 'SKETCH-1',
})})`;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-notes-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, input: writeNotesFixture(dir) };
}

/**
 * What a record type becomes, in the order the extractor gives it, with when it
 * was read. The account and Contacts are the fixture's, never the host's.
 */
async function payloads(Extractor, config, transformerConfig = {}) {
  const extractor = new Extractor({ limit: 0, ...config });
  const transformer = new AppleNotesTransformer({
    account: ACCOUNT,
    lookupContact,
    ...transformerConfig,
  });
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
async function nodes(Extractor, config, transformerConfig) {
  return (await payloads(Extractor, config, transformerConfig)).map(({ data }) =>
    withoutDirectives(data)
  );
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
const lastEditKey = ['@type', 'source', 'object.sourceId', 'timestamp'];
const editKey = ['@type', 'source', 'object.sourceId', 'agent.sourceId', 'startTime'];
const identity = (source, handle) => ({
  '@type': 'Agent',
  '@key': ['@type', 'source', 'handle'],
  source,
  handle,
});
// You, by your Apple Account, as the other Apple plugins key you.
const pat = {
  '@type': 'Person',
  '@key': key,
  source: 'icloud',
  sourceId: ACCOUNT.dsid,
  handle: ACCOUNT.email,
  sameAs: ['@me'],
};
// You, as Notes knows you: by your CloudKit user ID, with the name the shares list.
const patInNotes = {
  '@type': 'Person',
  '@key': key,
  source: 'apple-notes',
  sourceId: '_you',
  name: 'Pat Doe',
  sameAs: ['@me'],
};
// Sam, by both emails the shares list, and the number and card Contacts finds
// for one of them.
const sam = {
  '@type': 'Person',
  '@key': key,
  source: 'apple-notes',
  sourceId: '_sam',
  name: 'Sam Rivera',
  sameAs: [
    identity('email', 'sam@example.com'),
    identity('email', 'sam.rivera@work.example.com'),
    identity('phone', '+16135550142'),
    {
      '@type': 'Person',
      '@key': ['source', 'sourceId'],
      source: 'apple-contacts',
      sourceId: 'CONTACT-SAM',
      name: 'Sam Rivera',
    },
  ],
};
const note = (sourceId, name) => ({
  '@type': 'Note',
  '@key': key,
  source: 'apple-notes',
  sourceId,
  name,
});
const folder = (sourceId, name, owner) => ({
  '@type': 'Collection',
  '@key': ['@type', 'source', 'inAccount[*].sourceId', 'sourceId'],
  source: 'apple-notes',
  sourceId,
  name,
  inAccount: [owner],
});
const at = seconds => new Date((NOON + seconds) * 1000);

test('each note is its last edit, with the note as it is now, and when it was made', async t => {
  const { dir, input } = fixture(t);
  const actions = await nodes(AppleNotesExtractor, { input });

  assert.deepEqual(
    actions.map(action => [action['@type'], action.object?.sourceId ?? action.sourceId]),
    [
      ['UpdateAction', 'NOTE-SOUP'],
      ['CreateAction', 'NOTE-SOUP'],
      ['UpdateAction', 'NOTE-LOCKED'],
      ['CreateAction', 'NOTE-LOCKED'],
      ['UpdateAction', 'NOTE-GARDEN'],
      ['CreateAction', 'NOTE-GARDEN'],
      ['UpdateAction', 'NOTE-OLD'],
      ['CreateAction', 'NOTE-OLD'],
    ],
    'last edited first; the note marked for deletion is left out'
  );
  const [soup, soupMade, locked, lockedMade, garden, gardenMade, old, oldMade] = actions;

  // Notes saved it a moment after you wrote its newest text.
  assert.deepEqual(garden, {
    '@type': 'UpdateAction',
    '@key': lastEditKey,
    source: 'apple-notes',
    timestamp: at(3 * 3600 + 30.25),
    agent: pat,
    object: {
      ...note('NOTE-GARDEN', 'Garden plan'),
      body: [
        '# Garden plan',
        'Order **seeds** from [the catalog](https://seeds.example.com)',
        '- [x] Tomatoes, cherry',
        '- [ ] Basil',
        seedlings,
        sketch,
        'See #garden',
      ].join('\n'),
      tags: ['garden'],
      isPartOf: [folder('FOLDER-NOTES', 'Notes', patInNotes)],
      contains: [
        {
          '@type': 'ImageObject',
          '@key': key,
          source: 'apple-notes',
          sourceId: 'IMAGE-1',
          contentPath: join(dir, 'Accounts/ACCOUNT-1/Media/MEDIA-1/GENERATION-2/seedlings.jpeg'),
        },
        // A drawing's file is the image Notes keeps of it.
        {
          '@type': 'ImageObject',
          '@key': key,
          source: 'apple-notes',
          sourceId: 'SKETCH-1',
          contentPath: join(
            dir,
            'Accounts/ACCOUNT-1/FallbackImages/SKETCH-1/GENERATION-1/FallbackImage.png'
          ),
        },
      ],
    },
  });
  assert.deepEqual(gardenMade, {
    '@type': 'CreateAction',
    '@key': key,
    source: 'apple-notes',
    sourceId: 'NOTE-GARDEN',
    timestamp: at(-60),
    agent: pat,
    result: note('NOTE-GARDEN', 'Garden plan'),
  });

  // Made by Sam in Sam's folder. Its newest text, from a replica the note maps
  // to no one, synced in after Notes last saved it, so it was last edited
  // then, by no one known. A table isn't a file, so the note contains nothing.
  assert.deepEqual(soupMade.agent, sam);
  assert.deepEqual([soup.timestamp, soup.agent], [at(86_900), undefined]);
  assert.equal(soup.object.body, '# Soup\nCarrots, leeks\n[table]\nMore salt\nBay leaf');
  assert.deepEqual(soup.object.isPartOf, [folder('FOLDER-KITCHEN', 'Kitchen', sam)]);
  // Notes names its own folders the same in every account, so a folder is
  // keyed within its owner's.
  assert.notEqual(
    nodeKey(folder('DefaultFolder-CloudKit', 'Notes', patInNotes)),
    nodeKey(folder('DefaultFolder-CloudKit', 'Notes', sam))
  );
  assert.equal(soup.object.contains, undefined);

  // With no text that says when it was written, a note was last edited when
  // Notes last saved it, or else when it was made, by the one person it maps
  // any replica to. A locked note's text can't be read; a note never synced
  // was made and changed here.
  assert.equal(locked.object.body, undefined);
  assert.deepEqual([locked.timestamp, locked.agent, lockedMade.agent], [at(4 * 3600), pat, pat]);
  assert.equal(old.object.body, '# Old list\n- Milk');
  assert.deepEqual([old.timestamp, old.agent, oldMade.agent], [oldMade.timestamp, pat, pat]);

  // A note can lose all its text, its last hashtag, or its last attachment, so
  // it says it has none, but not of the text it can't read.
  const asserts = (await payloads(AppleNotesExtractor, { input }))
    .filter(({ data }) => data['@type'] === 'UpdateAction')
    .map(({ data }) => [data.object.sourceId, data.object['@asserts']]);
  assert.deepEqual(asserts, [
    ['NOTE-SOUP', ['body', 'tags', 'contains', '*']],
    ['NOTE-LOCKED', ['contains', '*']],
    ['NOTE-GARDEN', ['body', 'tags', 'contains', '*']],
    ['NOTE-OLD', ['body', 'tags', 'contains', '*']],
  ]);

  // With no Apple Account signed in, you're who Notes knows you as.
  const gardenHere = (await nodes(AppleNotesExtractor, { input }, { account: null })).find(
    action => action['@type'] === 'CreateAction' && action.sourceId === 'NOTE-GARDEN'
  );
  assert.deepEqual(gardenHere.agent, patInNotes);
});

test("what the database doesn't say, or says in a form that can't be read, doesn't stop a run", async t => {
  const { input } = fixture(t);
  const db = new DatabaseSync(input);
  // Who edited the garden, cut off partway through a number.
  db.prepare(
    "UPDATE ZICCLOUDSYNCINGOBJECT SET ZREPLICAIDTOUSERIDDICTDATA = ? WHERE ZIDENTIFIER = 'NOTE-GARDEN'"
  ).run(Buffer.from([0x08, 0x80]));
  // The old list's title, stamped with a time no date can hold.
  db.prepare('UPDATE ZICNOTEDATA SET ZDATA = ? WHERE ZNOTE = 12').run(
    noteData(
      [REPLICA.mac],
      [
        { text: 'Old list\n', replica: 1, style: 0, at: 2 ** 60 },
        { text: 'Milk', replica: 1, style: 100 },
      ]
    )
  );
  // The soup's table, with no type in the database.
  db.prepare(
    "UPDATE ZICCLOUDSYNCINGOBJECT SET ZTYPEUTI = NULL WHERE ZIDENTIFIER = 'TABLE-1'"
  ).run();
  db.close();

  const actions = await nodes(AppleNotesExtractor, { input });
  const lastEdit = id =>
    actions.find(action => action['@type'] === 'UpdateAction' && action.object.sourceId === id);
  const made = id =>
    actions.find(action => action['@type'] === 'CreateAction' && action.sourceId === id);
  // The garden's text reads, but not who wrote it.
  assert.match(lastEdit('NOTE-GARDEN').object.body, /^# Garden plan\n/);
  assert.equal(lastEdit('NOTE-GARDEN').agent, undefined);
  // The old list has no time it was written, so it was last edited when made.
  assert.equal(lastEdit('NOTE-OLD').object.body, '# Old list\n- Milk');
  assert.deepEqual(lastEdit('NOTE-OLD').timestamp, made('NOTE-OLD').timestamp);
  assert.equal(
    lastEdit('NOTE-SOUP').object.body,
    '# Soup\nCarrots, leeks\n[attachment]\nMore salt\nBay leaf'
  );
});

test('notes are bounded by when they were last edited', async t => {
  const { input } = fixture(t);
  const saved = async config =>
    (await nodes(AppleNotesExtractor, { input, ...config }))
      .filter(action => action['@type'] === 'UpdateAction')
      .map(action => action.object.sourceId);

  assert.deepEqual(await saved({ limit: 2 }), ['NOTE-SOUP', 'NOTE-LOCKED']);
  // The garden note's last text is from before the window, but Notes saved it
  // a moment later, inside it.
  assert.deepEqual(await saved({ since: at(3 * 3600 + 30.1), until: at(86_400) }), [
    'NOTE-LOCKED',
    'NOTE-GARDEN',
  ]);
  // Notes last saved the soup before the window, but its newest text synced in
  // after, inside it.
  assert.deepEqual(await saved({ since: at(86_400 + 460) }), ['NOTE-SOUP']);
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
      by: ACCOUNT.dsid,
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
      by: ACCOUNT.dsid,
      start: at(3 * 3600),
      end: at(3 * 3600 + 30),
      text: `${seedlings}\n${sketch}\nSee #garden`,
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
      by: ACCOUNT.dsid,
      start: at(0),
      end: at(120),
      text: '# Garden plan\nOrder **seeds** from [the catalog](https://seeds.example.com)\n- [x] Tomatoes',
    },
  ]);

  // Read only when asked for.
  assert.equal(AppleNotesEditsExtractor.default, false);

  const samsEdit = edits.find(
    edit => edit.agent?.sourceId === '_sam' && edit.object.sourceId === 'NOTE-GARDEN'
  );
  assert.deepEqual(samsEdit, {
    '@type': 'UpdateAction',
    '@key': editKey,
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
    edit => edit.object.sourceId === 'NOTE-GARDEN' && edit.agent?.sourceId === ACCOUNT.dsid
  );
  assert.deepEqual(
    garden.map(edit => edit.result.body),
    [
      `${seedlings}\n${sketch}\nSee #garden`,
      '- [x] Tomatoes',
      'Order **seeds** from [the catalog](https://seeds.example.com)',
      '# Garden plan',
    ]
  );

  // Only edits read the gap, so a run that gives it without kinds reads them.
  assert.deepEqual(AppleNotesEditsExtractor.kindsFor({ sessionGap: '5' }), ['edits']);
  assert.equal(AppleNotesEditsExtractor.kindsFor({}), undefined);
});
