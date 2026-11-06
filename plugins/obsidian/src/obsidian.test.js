import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { countMonth } from '@chronicle.app/etl';
import { ObsidianExtractor } from '../dist/index.js';
import { at, extract, transform, vault } from './fixture.test-helper.js';

const realm = {
  '@type': 'Realm',
  '@key': ['@type', 'source', 'handle'],
  source: 'obsidian',
  handle: 'Notebook',
  '@asserts': ['*'],
};
const noteWork = (handle, name, more = {}) => ({
  '@type': 'Note',
  '@key': ['source', 'handle', 'inRealm.handle'],
  source: 'obsidian',
  handle,
  name,
  inRealm: realm,
  ...more,
  '@asserts': ['*'],
});

const body = [
  'Order seeds before [[Planting schedule|the plan]] and [[Planting schedule#May]].',
  'See [the catalog](https://seeds.example.com) and [again](https://seeds.example.com/).',
  '[Welcome](../Welcome.md) ![[Photo]] [[photo.png]] [[Missing]] [[Seeds]]',
  '[[Sam]] is ambiguous; [[People/Sam]] is not. [Mail](mailto:you@example.com)',
  '`[[Hidden]]` <!-- [[Hidden]] --> %% [[Hidden]] %%',
  '```md',
  '[[Hidden]]',
  '```',
  '',
].join('\n');

test('a vault becomes schema-valid note updates with tags and resolved links', async t => {
  const root = vault(t, {
    'Garden/Seeds.md': [
      [
        '---',
        'tags: ["#garden", "todo/spring", "garden"]',
        'type: person',
        'birthday: 1990-02-14',
        '---',
        body,
      ].join('\n'),
      30,
    ],
    'Garden/Planting schedule.md': ['May: tomatoes', 10],
    'Welcome.md': ['# Welcome', 20],
    'Photo.md': ['A note named Photo', 5],
    'Hidden.md': ['Linked only from code', 5],
    'People/Sam.md': ['', 5],
    'Work/Sam.md': ['', 5],
    'image.png': 'not a note',
    '.hidden.md': 'hidden',
    '.trash/Deleted.md': 'deleted',
  });

  const { records, extractor, count } = await extract(root);
  assert.equal(count, 7);
  // Newest-modified first, path order breaking ties.
  assert.deepEqual(
    records.map(r => extractor.keyOf(r)),
    [
      'Garden/Seeds.md',
      'Welcome.md',
      'Garden/Planting schedule.md',
      'Hidden.md',
      'People/Sam.md',
      'Photo.md',
      'Work/Sam.md',
    ]
  );
  assert.deepEqual(records[0].context, {
    recordType: 'notes',
    vault: 'Notebook',
    paths: [
      'Garden/Planting schedule.md',
      'Garden/Seeds.md',
      'Hidden.md',
      'People/Sam.md',
      'Photo.md',
      'Welcome.md',
      'Work/Sam.md',
    ],
  });
  // Custom properties stay in the raw record; the body omits the frontmatter.
  const { birthtime, ...raw } = records[0].data;
  assert.ok(birthtime === undefined || typeof birthtime === 'string');
  assert.deepEqual(raw, {
    path: 'Garden/Seeds.md',
    name: 'Seeds',
    tags: ['garden', 'todo/spring'],
    frontmatter: {
      tags: ['#garden', 'todo/spring', 'garden'],
      type: 'person',
      birthday: '1990-02-14',
    },
    body,
    mtime: at(30).toISOString(),
  });

  const [update] = await transform(records.slice(0, 1));
  const asOf = at(30).toISOString();
  assert.deepEqual(update, {
    '@type': 'UpdateAction',
    '@key': ['@type', 'source', 'object.handle', 'object.inRealm.handle', 'timestamp'],
    source: 'obsidian',
    timestamp: asOf,
    '@assertedAt': asOf,
    '@asserts': ['*'],
    agent: {
      '@type': 'Person',
      '@key': ['@type', 'source'],
      source: 'obsidian',
      sameAs: ['@me'],
      '@asserts': ['*'],
    },
    object: {
      ...noteWork('Garden/Seeds.md', 'Seeds'),
      body,
      tags: ['garden', 'todo/spring'],
      // First-seen order: wikilinks and embeds, then Markdown links.
      references: [
        noteWork('Garden/Planting schedule.md', 'Planting schedule'),
        noteWork('Photo.md', 'Photo'),
        noteWork('People/Sam.md', 'Sam'),
        {
          '@type': 'Entity',
          '@key': ['url'],
          source: 'url',
          url: 'https://seeds.example.com/',
          '@asserts': ['*'],
        },
        noteWork('Welcome.md', 'Welcome'),
      ],
      '@asserts': ['*'],
    },
  });
});

test('a limited subfolder import keeps the enclosing vault identity', async t => {
  const root = vault(t, {
    'Welcome.md': ['See [[Notes/Ideas]].', 0],
    'Notes/Ideas.md': ['Back to [[Welcome]].', 20],
    'Notes/Reading.md': ['See [[Ideas]].', 10],
  });
  const all = await extract(root);
  const subset = await extract(join(root, 'Notes'), 1);
  assert.equal(subset.count, 1);
  assert.deepEqual(
    subset.records.map(r => r.data.path),
    ['Notes/Ideas.md']
  );
  assert.deepEqual(subset.records[0].context, all.records[0].context);
  const [fromAll] = await transform(all.records.slice(0, 1));
  const [fromSubset] = await transform(subset.records);
  assert.deepEqual(fromSubset, fromAll);
  assert.deepEqual(fromSubset.object.references, [noteWork('Welcome.md', 'Welcome')]);
});

test('a survey counts the notes a run reads, whatever its limit, and when they were last edited', async t => {
  const root = vault(t, {
    'Welcome.md': ['Hello.', 0],
    'Notes/Ideas.md': ['An idea.', 20],
    'Notes/Reading.md': ['A book.', 10],
  });
  const limited = await extract(root, 1);
  assert.equal(limited.records.length, 1);
  assert.deepEqual(limited.survey, { notes: { count: 3, earliest: at(0), latest: at(20) } });
  assert.deepEqual((await extract(join(root, 'Notes'))).survey, {
    notes: { count: 2, earliest: at(10), latest: at(20) },
  });
  assert.deepEqual((await extract(vault(t, {}))).survey, { notes: { count: 0 } });
  // By month when asked, by when each was last edited, in local time.
  const extractor = new ObsidianExtractor({ input: root, quiet: true });
  await extractor.setup();
  const months = {};
  for (const seconds of [0, 20, 10]) countMonth(months, at(seconds));
  assert.deepEqual((await extractor.survey({ byMonth: true })).notes.byMonth, months);
});

test('without .obsidian the input folder is the vault; an empty vault yields nothing', async t => {
  const root = vault(t, { 'Upper.MD': 'Upper' }, { name: 'Loose', obsidian: false });
  const { records } = await extract(root);
  assert.deepEqual(
    records.map(r => [r.context.vault, r.data.path, r.data.name]),
    [['Loose', 'Upper.MD', 'Upper']]
  );

  const empty = await extract(vault(t, {}));
  assert.deepEqual(empty.records, []);
  assert.equal(empty.count, 0);
});

test('strips only a complete leading frontmatter block', async t => {
  const cases = [
    ['---\n---\nBody\n', 'Body\n', {}],
    ['No frontmatter\n\n---\nBody rule\n', 'No frontmatter\n\n---\nBody rule\n', {}],
    ['---\ntags: [unfinished]\n', '---\ntags: [unfinished]\n', {}],
    ['﻿---\ntags: [ideas]\n---\n\nBody\n', '\nBody\n', { tags: ['ideas'] }],
    ['---\ntags: [ideas]\n---', '', { tags: ['ideas'] }],
    ['---\r\ntags: a, b c\r\n---\r\nText\r\n', 'Text\r\n', { tags: 'a, b c' }],
    // Malformed YAML is still omitted from the body.
    ['---\ntags: [oops\n---\nContent\n', 'Content\n', {}],
  ];
  const root = vault(
    t,
    Object.fromEntries(cases.map(([input], index) => [`Note ${index}.md`, input]))
  );
  const { records } = await extract(root);
  const byPath = new Map(records.map(r => [r.data.path, r.data]));
  for (const [index, [, body, frontmatter]] of cases.entries()) {
    const note = byPath.get(`Note ${index}.md`);
    assert.equal(note.body, body, `case ${index}`);
    assert.deepEqual(note.frontmatter, frontmatter, `case ${index}`);
  }
  assert.deepEqual(byPath.get('Note 5.md').tags, ['a', 'b', 'c']);
});

test('a note covers the days in its name, or the month or week it is named', async t => {
  const root = vault(t, {
    'Journal/2019-03-14.md': 'A day.',
    '2026-05.md': 'A monthly recap.',
    '2026-W19.md': 'A weekly note.',
    '2026-W53.md': 'The last week of a long year.',
    '2025-W53.md': 'A week 2025 does not have.',
    '2019-02-30.md': 'A day no year has.',
    '2026-13.md': 'A month no year has.',
    '1984.md': 'The book, not the year.',
    'Links.md': '[[2019-03-14]]',
    'Garden tour (2026-11-06).md': 'A day in a title.',
    'seed-swap-2026-11-07.md': 'A day in a slug.',
    '2026-11-08 harvest.md': 'A day to start with.',
    'From 2026-11-09 to 2026-11-11, then 2026-11-09 again.md': 'Two days, one repeated.',
    'Tour (2026-13-40).md': 'A day no year has.',
    'Ticket 12026-11-06.md': 'A longer number.',
    'Ticket 1234-2026-11-06.md': 'A longer number, with a hyphen.',
    'Recap 2026-05.md': 'A month counts only as the whole name.',
    '2026-11-12/Notes.md': 'A folder is not the name.',
  });
  const out = await transform((await extract(root)).records);
  const covered = Object.fromEntries(out.map(a => [a.object.handle, a.object.dateCovered]));
  assert.deepEqual(covered, {
    'Journal/2019-03-14.md': ['2019-03-14'],
    '2026-05.md': ['2026-05'],
    '2026-W19.md': ['2026-05-04/2026-05-10'],
    '2026-W53.md': ['2026-12-28/2027-01-03'],
    '2025-W53.md': undefined,
    '2019-02-30.md': undefined,
    '2026-13.md': undefined,
    '1984.md': undefined,
    'Links.md': undefined,
    'Garden tour (2026-11-06).md': ['2026-11-06'],
    'seed-swap-2026-11-07.md': ['2026-11-07'],
    '2026-11-08 harvest.md': ['2026-11-08'],
    'From 2026-11-09 to 2026-11-11, then 2026-11-09 again.md': ['2026-11-09', '2026-11-11'],
    'Tour (2026-13-40).md': undefined,
    'Ticket 12026-11-06.md': undefined,
    'Ticket 1234-2026-11-06.md': undefined,
    'Recap 2026-05.md': undefined,
    '2026-11-12/Notes.md': undefined,
  });
  // A link to a dated note says the same as the note does.
  const links = out.find(a => a.object.handle === 'Links.md').object;
  assert.deepEqual(links.references[0].dateCovered, ['2019-03-14']);
});

test("a vault's Daily Notes settings say how its days are named", async t => {
  const covered = async (settings, files) => {
    const root = vault(t, {
      '.obsidian/daily-notes.json': settings,
      ...Object.fromEntries(files.map(file => [file, 'A day.'])),
    });
    const out = await transform((await extract(root)).records);
    return Object.fromEntries(out.map(a => [a.object.handle, a.object.dateCovered?.[0]]));
  };

  assert.deepEqual(
    await covered(JSON.stringify({ folder: 'Journal/', format: 'MMMM Do, YYYY' }), [
      'Journal/March 14th, 2019.md',
      'Journal/Marchtober 14th, 2019.md',
      'Elsewhere/March 14th, 2019.md',
      // A name that is exactly a date still is one, wherever it is.
      'Elsewhere/2019-03-15.md',
    ]),
    {
      'Journal/March 14th, 2019.md': '2019-03-14',
      'Journal/Marchtober 14th, 2019.md': undefined,
      'Elsewhere/March 14th, 2019.md': undefined,
      'Elsewhere/2019-03-15.md': '2019-03-15',
    }
  );
  // A field written twice has to agree, and literal text in brackets is literal.
  assert.deepEqual(
    await covered(JSON.stringify({ format: 'YYYY/[Day] DD-MM-YYYY, ddd' }), [
      '2019/Day 14-03-2019, Thu.md',
      '2018/Day 14-03-2019, Thu.md',
    ]),
    { '2019/Day 14-03-2019, Thu.md': '2019-03-14', '2018/Day 14-03-2019, Thu.md': undefined }
  );
  // A format with a token this can't read, or settings it can't parse, name no days.
  assert.deepEqual(await covered(JSON.stringify({ format: 'gggg-DD-MM' }), ['2019-14-03.md']), {
    '2019-14-03.md': undefined,
  });
  assert.deepEqual(await covered('{ not json', ['14-03-2019.md', '2019-03-14.md']), {
    '14-03-2019.md': undefined,
    '2019-03-14.md': '2019-03-14',
  });
});
