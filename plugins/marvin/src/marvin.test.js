import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarvinAnnotationsExtractor, MarvinSessionsExtractor } from '../dist/index.js';

// Marvin escapes commas inside author names as `\,`.
const SESSIONS_CSV = `Session ID,Book Title,Book Author,Date Created,Part Time
s2,Tides of Amber,"Rivera\\, Tom",2024-03-05T07:30:00Z,120
s1,The Lantern Keeper,"Doe\\, Jane",2024-03-01T21:10:00Z,300
s1,The Lantern Keeper,"Doe\\, Jane",2024-03-01T21:20:00Z,600
s1,The Lantern Keeper,"Doe\\, Jane",2024-03-01T21:15:00Z,0.5
`;

const ANNOTATIONS_CSV = `ID,Title,Author,Date,HighlightText,EntryText
a1,The Lantern Keeper,"Doe\\, Jane",2024-03-02T08:00:00Z,"The light was steady, and so was she.",Echoes the opening chapter.
a2,The Lantern Keeper,"Doe\\, Jane",2024-03-02T08:05:00Z,A second highlight.,
a3,Tides of Amber,"Rivera\\, Tom",2024-03-06T10:00:00Z,,Reread the ending.
a4,Tides of Amber,"Rivera\\, Tom",2024-03-06T10:01:00Z,,
`;

function csvFile(t, name, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'marvin-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  writeFileSync(file, contents);
  return file;
}

async function records(Extractor, input) {
  const extractor = new Extractor({ input });
  return Array.fromAsync(extractor.extract());
}

async function transform(Extractor, record) {
  const transformer = new Extractor.defaultTransformer();
  const nodes = await transformer.performTransform(record);
  return nodes.map(node => node.data);
}

const me = {
  '@type': 'Person',
  '@key': ['@type', 'source'],
  source: 'marvin',
  sameAs: ['@me'],
};

function book(name, author) {
  return {
    '@type': 'Book',
    '@key': ['@type', 'source', 'name', 'author.name'],
    name,
    source: 'marvin',
    sourceId: name,
    author: [
      {
        '@type': 'Person',
        '@key': ['@type', 'source', 'name'],
        name: author,
        source: 'marvin',
        sourceId: author,
      },
    ],
  };
}

test('reading-session rows group into one ReadAction per session, oldest first', async t => {
  const input = csvFile(t, 'sessions.csv', SESSIONS_CSV);
  const rows = await records(MarvinSessionsExtractor, input);

  // Part times are summed; the latest Date Created ends the session.
  assert.deepEqual(
    rows.map(r => r.data),
    [
      {
        'Session ID': 's1',
        'Book Title': 'The Lantern Keeper',
        'Book Author': 'Doe\\, Jane',
        'Date Created': '2024-03-01T21:20:00.000Z',
        'Part Time': '900.5',
      },
      {
        'Session ID': 's2',
        'Book Title': 'Tides of Amber',
        'Book Author': 'Rivera\\, Tom',
        'Date Created': '2024-03-05T07:30:00Z',
        'Part Time': '120',
      },
    ]
  );
  assert.equal(rows[0].extraction.recordType, 'reading-sessions');

  const [read] = await transform(MarvinSessionsExtractor, rows[0]);
  assert.deepEqual(read, {
    '@type': 'ReadAction',
    '@key': ['@type', 'source', 'sourceId'],
    startTime: new Date('2024-03-01T21:04:59.500Z'),
    endTime: new Date('2024-03-01T21:20:00.000Z'),
    '@assertedAt': new Date('2024-03-01T21:04:59.500Z'),
    source: 'marvin',
    sourceId: 's1',
    agent: me,
    object: book('The Lantern Keeper', 'Doe, Jane'),
  });
});

test('annotations become QuoteActions and AnnotateActions', async t => {
  const input = csvFile(t, 'annotations.csv', ANNOTATIONS_CSV);
  const rows = await records(MarvinAnnotationsExtractor, input);

  // a4 has neither a highlight nor a note, so it is skipped.
  assert.deepEqual(
    rows.map(r => r.data.ID),
    ['a1', 'a2', 'a3']
  );
  assert.equal(rows[0].extraction.recordType, 'annotations');

  const lantern = book('The Lantern Keeper', 'Doe, Jane');
  const quotation = {
    '@type': 'Quotation',
    '@key': ['@type', 'source', 'sourceId'],
    body: 'The light was steady, and so was she.',
    source: 'marvin',
    sourceId: 'a1',
    isPartOf: [lantern],
  };
  const timestamp = new Date('2024-03-02T08:00:00Z');

  // A highlight with a note: the note's Comment is about the Quotation.
  assert.deepEqual(await transform(MarvinAnnotationsExtractor, rows[0]), [
    {
      '@type': 'QuoteAction',
      '@key': ['@type', 'source', 'sourceId'],
      timestamp,
      '@assertedAt': timestamp,
      source: 'marvin',
      sourceId: 'a1',
      agent: me,
      result: quotation,
    },
    {
      '@type': 'AnnotateAction',
      '@key': ['@type', 'source', 'sourceId'],
      timestamp,
      '@assertedAt': timestamp,
      source: 'marvin',
      sourceId: 'a1',
      agent: me,
      result: {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'sourceId'],
        description: 'Echoes the opening chapter.',
        source: 'marvin',
        sourceId: 'a1',
        about: [quotation],
      },
    },
  ]);

  // A highlight alone yields only the QuoteAction.
  assert.deepEqual(
    (await transform(MarvinAnnotationsExtractor, rows[1])).map(node => node['@type']),
    ['QuoteAction']
  );

  // A note without a highlight is about the Book.
  const noteOnly = new Date('2024-03-06T10:00:00Z');
  assert.deepEqual(await transform(MarvinAnnotationsExtractor, rows[2]), [
    {
      '@type': 'AnnotateAction',
      '@key': ['@type', 'source', 'sourceId'],
      timestamp: noteOnly,
      '@assertedAt': noteOnly,
      source: 'marvin',
      sourceId: 'a3',
      agent: me,
      result: {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'sourceId'],
        description: 'Reread the ending.',
        source: 'marvin',
        sourceId: 'a3',
        about: [book('Tides of Amber', 'Rivera, Tom')],
      },
    },
  ]);
});
