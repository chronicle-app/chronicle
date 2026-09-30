import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { at, extract, transform, vault } from './fixture.test-helper.js';

const realm = {
  '@type': 'Realm',
  '@key': ['@type', 'source', 'handle'],
  source: 'obsidian',
  handle: 'Notebook',
  '@asserts': ['*'],
};
const document = (handle, name) => ({
  '@type': 'DocumentObject',
  '@key': ['source', 'handle', 'inRealm.handle'],
  source: 'obsidian',
  handle,
  name,
  inRealm: realm,
  mimeType: 'text/markdown',
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

test('a vault becomes schema-valid document updates with tags and resolved links', async t => {
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
      ...document('Garden/Seeds.md', 'Seeds'),
      body,
      tags: ['garden', 'todo/spring'],
      // First-seen order: wikilinks and embeds, then Markdown links.
      references: [
        document('Garden/Planting schedule.md', 'Planting schedule'),
        document('Photo.md', 'Photo'),
        document('People/Sam.md', 'Sam'),
        {
          '@type': 'Entity',
          '@key': ['url'],
          source: 'url',
          url: 'https://seeds.example.com/',
          '@asserts': ['*'],
        },
        document('Welcome.md', 'Welcome'),
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
  assert.deepEqual(fromSubset.object.references, [document('Welcome.md', 'Welcome')]);
});

/**
 * Expands the package's `chronicle.deepLinks` template for a node the way a
 * host does: the node's `@type` over `*`, each `{var}` from `sourceId`,
 * `handle`, or an `@key` path, and no link when a variable is missing.
 */
function deepLink(node) {
  const { deepLinks } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url))
  ).chronicle;
  const template = deepLinks[node.source]?.[node['@type']] ?? deepLinks[node.source]?.['*'];
  if (!template) return;
  let missing = false;
  const url = template.replaceAll(/\{([^{}]+)\}/g, (_, name) => {
    let value;
    if (name === 'sourceId' || name === 'handle') value = node[name];
    else if (node['@key']?.includes(name)) {
      const [head, rest, ...deeper] = name.split('.');
      value = name in node ? node[name] : deeper.length > 0 ? undefined : node[head]?.[rest];
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return encodeURIComponent(value);
    }
    missing = true;
    return '';
  });
  return missing ? undefined : url;
}

test('notes link into their vault in Obsidian; the vault does not', async t => {
  const root = vault(
    t,
    { 'Garden/Planting schedule.md': 'See [[Welcome]].', 'Welcome.md': '' },
    { name: 'Field Notes' }
  );
  const [update] = await transform((await extract(root)).records.slice(0, 1));
  const note = update.object;
  assert.equal(note.handle, 'Garden/Planting schedule.md');
  assert.equal(
    deepLink(note),
    'obsidian://open?vault=Field%20Notes&file=Garden%2FPlanting%20schedule.md'
  );
  assert.equal(deepLink(note.references[0]), 'obsidian://open?vault=Field%20Notes&file=Welcome.md');
  assert.equal(deepLink(note.inRealm), undefined);
  assert.equal(deepLink(update), undefined);
  assert.equal(deepLink(update.agent), undefined);
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
