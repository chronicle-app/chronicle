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

test('a note covers the one ISO day in its name', async t => {
  const root = vault(t, {
    'Journal/2019-03-14.md': 'A day.',
    'Garden tour (2026-11-06).md': 'A day in a title.',
    'seed-swap-2026-11-07.md': 'A day in a slug.',
    '2026-11-08 harvest.md': 'A day to start with.',
    'From 2026-11-09 to 2026-11-11.md': 'Two days name no one day.',
    '2019-02-30.md': 'A day no year has.',
    'Ticket 12026-11-06.md': 'A longer number.',
    'Ticket 1234-2026-11-06.md': 'A longer number, with a hyphen.',
    '2026-05.md': 'A month is not a day.',
    '2026-W19.md': 'A week is not a day.',
    'March 14th, 2019.md': 'Only ISO days count.',
    '1984.md': 'The book, not the year.',
    '2026-11-12/Notes.md': 'A folder is not the name.',
    'Links.md': '[[2019-03-14]]',
  });
  const out = await transform((await extract(root)).records);
  const covered = Object.fromEntries(out.map(a => [a.object.handle, a.object.dateCovered]));
  assert.deepEqual(covered, {
    'Journal/2019-03-14.md': '2019-03-14',
    'Garden tour (2026-11-06).md': '2026-11-06',
    'seed-swap-2026-11-07.md': '2026-11-07',
    '2026-11-08 harvest.md': '2026-11-08',
    'From 2026-11-09 to 2026-11-11.md': undefined,
    '2019-02-30.md': undefined,
    'Ticket 12026-11-06.md': undefined,
    'Ticket 1234-2026-11-06.md': undefined,
    '2026-05.md': undefined,
    '2026-W19.md': undefined,
    'March 14th, 2019.md': undefined,
    '1984.md': undefined,
    '2026-11-12/Notes.md': undefined,
    'Links.md': undefined,
  });
  // A link to a dated note says the same as the note does.
  const links = out.find(a => a.object.handle === 'Links.md').object;
  assert.equal(links.references[0].dateCovered, '2019-03-14');
});
