import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SystemInfo, monthKey } from '@chronicle.app/etl';
import { ZoteroExtractor, ZoteroLocator, ZoteroTransformer, zoteroDataDir } from '../dist/index.js';
import {
  DB_MTIME,
  LOCAL_USER_KEY,
  READ_1,
  READ_2,
  USER_ID,
  writeZoteroFixture,
} from './fixture.test-helper.js';

// The extractor scopes file paths by this machine's name. A stub keeps the
// host's hostname out of the test.
const MACHINE = 'pat-mbp';
const realGetInstance = SystemInfo.getInstance;
SystemInfo.getInstance = async () => ({ getMachineName: () => MACHINE });
test.after(() => {
  SystemInfo.getInstance = realGetInstance;
});

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'zotero-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return writeZoteroFixture(dir);
}

async function actions(config) {
  const extractor = new ZoteroExtractor(config);
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new ZoteroTransformer();
    const out = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
    return out;
  } finally {
    await extractor.teardown();
  }
}

/**
 * The library is a snapshot source, so every typed node the transformer emits
 * also asserts completeness (`'*'`), after any `@asserts` of its own.
 */
function snapshot(node) {
  if (Array.isArray(node)) return node.map(n => snapshot(n));
  if (!node || typeof node !== 'object' || node instanceof Date) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = snapshot(v);
  if (typeof out['@type'] === 'string') out['@asserts'] = [...(out['@asserts'] ?? []), '*'];
  return out;
}

const assertedAt = DB_MTIME.toISOString();
const me = {
  '@type': 'Person',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'zotero',
  sourceId: LOCAL_USER_KEY,
  sameAs: ['@me'],
};
const library = {
  '@type': 'Realm',
  '@key': ['@type', 'source', 'handle'],
  source: 'zotero',
  handle: USER_ID,
};
const itemKey = ['source', 'sourceId', 'inRealm.handle'];
const ref = (type, sourceId, name) => ({
  '@type': type,
  '@key': itemKey,
  source: 'zotero',
  sourceId,
  inRealm: library,
  ...(name && { name }),
});
const article = ref('Article', 'WORKAAAA', 'Trail Erosion in Alpine Meadows');
const pdfFacet = { ...ref('DocumentObject', 'ATTPDF01'), sameAs: [article] };
const collection = (sourceId, name, parent) => ({
  '@type': 'Collection',
  '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
  source: 'zotero',
  sourceId,
  name,
  inRealm: library,
  ...(parent && { isPartOf: [parent] }),
});
const research = collection('COLLROOT', 'Research');
const named = (type, name) => ({
  '@type': type,
  '@key': ['@type', 'source', 'name'],
  source: 'zotero',
  name,
});
const edge = (type, source, sourceId, name, url) => ({
  '@type': type,
  '@key': ['source', 'sourceId'],
  source,
  sourceId,
  ...(url && { url }),
  name,
});
const filesystem = (type, file) => ({
  '@type': type,
  '@key': ['source', 'handle', 'inRealm.handle'],
  source: 'filesystem',
  handle: file,
  name: file.split('/').pop(),
  inRealm: {
    '@type': 'Realm',
    '@key': ['@type', 'source', 'handle'],
    source: 'hostname',
    handle: MACHINE,
  },
});
const action = (type, sourceId, timestamp, rest) =>
  snapshot({
    '@type': type,
    '@key':
      type === 'ViewAction'
        ? ['@type', 'source', 'sourceId', 'object.inRealm.handle', 'timestamp']
        : type === 'BookmarkAction'
          ? ['@type', 'source', 'sourceId', 'object.inRealm.handle']
          : ['@type', 'source', 'sourceId', 'result.inRealm.handle'],
    source: 'zotero',
    sourceId,
    timestamp: new Date(timestamp),
    agent: me,
    ...rest,
  });
const expected = node => ({ ...node, '@assertedAt': assertedAt });

test('a Zotero library becomes schema-valid actions', async t => {
  const dir = fixture(t);
  const out = await actions({ input: dir });
  const storage = (key, name) => join(dir, 'storage', key, name);

  // Works, annotations, orphan attachments, then notes, each newest-modified
  // first. Trashed items, anything under them, and group libraries are left
  // out, as are annotations with neither text nor a comment.
  assert.deepEqual(
    out.map(a => `${a['@type']} ${a.sourceId}`),
    [
      'BookmarkAction WORKAAAA',
      'ViewAction ATTPDF01',
      'BookmarkAction SECTION1',
      'BookmarkAction BOOKAAAA',
      'ViewAction BOOKATT1',
      'QuoteAction ANNOEPUB',
      'AnnotateAction ANNONOTE',
      'QuoteAction ANNOPDF1',
      'AnnotateAction ANNOPDF1',
      'BookmarkAction ORPHAN01',
      'ViewAction ORPHAN01',
      'AnnotateAction NOTE0002',
      'AnnotateAction NOTE0001',
    ]
  );
  const find = (type, sourceId) => out.find(a => a['@type'] === type && a.sourceId === sourceId);

  // The work carries its fields, creators, protocol sameAs edges, periodical,
  // nested collections, and tags. seriesEditor is skipped.
  assert.deepEqual(
    find('BookmarkAction', 'WORKAAAA'),
    expected(
      action('BookmarkAction', 'WORKAAAA', '2025-01-10T08:00:00.000Z', {
        object: {
          ...article,
          description: 'How foot traffic wears down alpine trails.',
          datePublished: '2024-07',
          url: 'https://journal.example.org/erosion',
          author: [named('Person', 'Pat Example'), named('Organization', 'Trail Institute')],
          creator: [named('Person', 'Alex Example')],
          sameAs: [
            edge(
              'Article',
              'doi',
              '10.5555/trails.2024',
              article.name,
              'https://doi.org/10.5555/trails.2024'
            ),
            edge(
              'Article',
              'arxiv',
              '2401.01234',
              article.name,
              'https://arxiv.org/abs/2401.01234'
            ),
            edge('Article', 'pubmed', '12345678', article.name),
            edge('Article', 'pmc', 'PMC7654321', article.name),
          ],
          isPartOf: [
            {
              ...named('CreativeWork', 'Journal of Trails'),
              sameAs: [
                edge('CreativeWork', 'issn', '1234-5678', 'Journal of Trails'),
                edge('CreativeWork', 'issn', '8765-4321', 'Journal of Trails'),
              ],
            },
            collection('COLLCHLD', 'Fieldwork', research),
          ],
          about: [
            {
              '@type': 'Tag',
              '@key': ['@type', 'source', 'handle'],
              source: 'zotero',
              handle: 'hiking',
            },
          ],
          '@asserts': ['isPartOf', 'about'],
        },
      })
    )
  );

  // Opening the PDF is a ViewAction on a nameless facet of the work, which
  // also carries the file's path on this machine. The unopened snapshot
  // appears nowhere.
  const pdfPath = storage('ATTPDF01', 'erosion.pdf');
  assert.deepEqual(
    find('ViewAction', 'ATTPDF01'),
    expected(
      action('ViewAction', 'ATTPDF01', new Date(READ_1 * 1000).toISOString(), {
        object: {
          ...ref('DocumentObject', 'ATTPDF01'),
          mimeType: 'application/pdf',
          contentPath: pdfPath,
          sameAs: [article, filesystem('DocumentObject', pdfPath)],
        },
      })
    )
  );
  assert.equal(out.filter(a => a.sourceId === 'ATTSNAP1').length, 0);

  // A book: ISBN-10 becomes ISBN-13, and pageCount and publisher are set.
  const book = ref('Book', 'BOOKAAAA', 'Collected Trails');
  const isbn = edge('Book', 'isbn', '9780306406157', 'Collected Trails');
  assert.deepEqual(
    find('BookmarkAction', 'BOOKAAAA'),
    expected(
      action('BookmarkAction', 'BOOKAAAA', '2024-11-05T10:00:00.000Z', {
        object: {
          ...book,
          datePublished: '2019',
          pageCount: 320,
          publisher: [named('Organization', 'Example Press')],
          sameAs: [isbn],
          '@asserts': ['isPartOf', 'about'],
        },
      })
    )
  );
  // A book section's ISBN names the containing book, not the section.
  assert.deepEqual(
    find('BookmarkAction', 'SECTION1').object,
    snapshot({
      ...ref('Book', 'SECTION1', 'The Ridge Route'),
      isPartOf: [{ ...named('Book', 'Collected Trails'), sameAs: [isbn] }],
      '@asserts': ['isPartOf', 'about'],
    })
  );
  // The book's file has the same bytes as the section's, so it keeps only the
  // work sameAs: no path and no filesystem edge.
  assert.deepEqual(
    find('ViewAction', 'BOOKATT1'),
    expected(
      action('ViewAction', 'BOOKATT1', new Date(READ_2 * 1000).toISOString(), {
        object: {
          ...ref('DocumentObject', 'BOOKATT1'),
          mimeType: 'application/pdf',
          sameAs: [book],
        },
      })
    )
  );

  // A PDF highlight with a comment: a QuoteAction with a page selector, and an
  // AnnotateAction whose Comment is about the quotation.
  const quotation = {
    '@type': 'Quotation',
    '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
    source: 'zotero',
    sourceId: 'ANNOPDF1',
    inRealm: library,
    body: 'Erosion doubles on wet days.',
    color: '#ffd400',
    annotationStyle: 'highlight',
    isPartOf: [pdfFacet],
    selector: [
      {
        '@type': 'PageSelector',
        '@key': ['@type', 'selectorValue'],
        selectorValue: '12',
        selectorLabel: '12',
      },
    ],
  };
  const comment = (sourceId, rest) => ({
    '@type': 'Comment',
    '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
    source: 'zotero',
    sourceId,
    inRealm: library,
    ...rest,
  });
  assert.deepEqual(
    find('QuoteAction', 'ANNOPDF1'),
    expected(action('QuoteAction', 'ANNOPDF1', '2025-01-11T09:00:00.000Z', { result: quotation }))
  );
  assert.deepEqual(
    find('AnnotateAction', 'ANNOPDF1'),
    expected(
      action('AnnotateAction', 'ANNOPDF1', '2025-01-11T09:00:00.000Z', {
        result: comment('ANNOPDF1', { description: 'Check the 2023 data.', about: [quotation] }),
      })
    )
  );
  // A comment with no highlighted text is about the file facet.
  assert.deepEqual(
    find('AnnotateAction', 'ANNONOTE').result,
    snapshot(
      comment('ANNONOTE', { description: 'Compare with the ridge study.', about: [pdfFacet] })
    )
  );

  // An underline in a standalone EPUB: an EPUB CFI selector, part of the
  // attachment's own named entity. The generic title "EPUB" gives way to the
  // filename.
  const epubPath = storage('ORPHAN01', 'field-guide.epub');
  const epub = ref('DocumentObject', 'ORPHAN01', 'field-guide.epub');
  assert.deepEqual(
    find('QuoteAction', 'ANNOEPUB').result,
    snapshot({
      ...quotation,
      sourceId: 'ANNOEPUB',
      body: 'Carry more water than you think.',
      annotationStyle: 'underline',
      isPartOf: [epub],
      selector: [
        {
          '@type': 'EpubCfiSelector',
          '@key': ['@type', 'selectorValue'],
          selectorValue: 'epubcfi(/6/4!/4/2/1:0)',
        },
      ],
    })
  );

  // The standalone EPUB is saved on its own, with its own path, collection,
  // and tag, and its last open is a ViewAction on it.
  assert.deepEqual(
    find('BookmarkAction', 'ORPHAN01'),
    expected(
      action('BookmarkAction', 'ORPHAN01', '2025-01-20T12:00:00.000Z', {
        object: {
          ...epub,
          mimeType: 'application/epub+zip',
          contentPath: epubPath,
          sameAs: [filesystem('DocumentObject', epubPath)],
          isPartOf: [research],
          about: [
            {
              '@type': 'Tag',
              '@key': ['@type', 'source', 'handle'],
              source: 'zotero',
              handle: 'guides',
            },
          ],
          '@asserts': ['isPartOf', 'about'],
        },
      })
    )
  );
  assert.deepEqual(
    find('ViewAction', 'ORPHAN01'),
    expected(
      action('ViewAction', 'ORPHAN01', new Date(READ_1 * 1000).toISOString(), { object: epub })
    )
  );

  // Note items keep Zotero's HTML verbatim; a child note is about its work.
  assert.deepEqual(
    find('AnnotateAction', 'NOTE0001'),
    expected(
      action('AnnotateAction', 'NOTE0001', '2025-01-12T18:00:00.000Z', {
        result: comment('NOTE0001', {
          body: '<div data-schema-version="9"><p>Reading notes</p><p>Useful for the talk.</p></div>',
          name: 'Reading notes',
          about: [article],
        }),
      })
    )
  );
  assert.deepEqual(
    find('AnnotateAction', 'NOTE0002').result,
    snapshot(comment('NOTE0002', { body: '<p>Buy a new map.</p>' }))
  );
});

test('since, until, and limit filter on each item’s dateModified', async t => {
  const dir = fixture(t);

  const extractor = new ZoteroExtractor({
    input: dir,
    since: new Date('2025-01-12T00:00:00Z'),
    until: new Date('2025-01-31T00:00:00Z'),
  });
  try {
    await extractor.setup();
    assert.equal(await extractor.determineCount(), 4);
    const records = await Array.fromAsync(extractor.extract());
    assert.deepEqual(
      records.map(r => `${r.extraction.recordType} ${r.data.key}`),
      ['annotations ANNOEPUB', 'attachments ORPHAN01', 'notes NOTE0002', 'notes NOTE0001']
    );
  } finally {
    await extractor.teardown();
  }

  // The limit counts records across every record type.
  const limited = await actions({ input: join(dir, 'zotero.sqlite'), limit: 2 });
  assert.deepEqual(
    limited.map(a => a.sourceId),
    ['WORKAAAA', 'ATTPDF01', 'SECTION1']
  );
});

async function extractAndSurvey(config, options = {}) {
  const extractor = new ZoteroExtractor(config);
  try {
    await extractor.setup();
    const survey = await extractor.survey(options);
    return { survey, records: await Array.fromAsync(extractor.extract()) };
  } finally {
    await extractor.teardown();
  }
}

/** Zotero's UTC `YYYY-MM-DD HH:MM:SS`, as a Date. */
const zoteroDate = raw => new Date(`${raw.replace(' ', 'T')}Z`);

/** Each record type's count, and its first and last record by when it was added. */
function surveyOf(records) {
  const survey = {};
  for (const recordType of ['works', 'annotations', 'attachments', 'notes']) {
    const added = records
      .filter(record => record.extraction.recordType === recordType)
      .map(record => zoteroDate(record.data.dateAdded));
    survey[recordType] = {
      count: added.length,
      ...(added.length > 0 && {
        earliest: new Date(Math.min(...added)),
        latest: new Date(Math.max(...added)),
      }),
    };
  }
  return survey;
}

/** Each record type's records by the month they were added, as a survey's `byMonth` keys them. */
function monthsOf(records) {
  const months = {};
  for (const recordType of ['works', 'annotations', 'attachments', 'notes']) {
    months[recordType] = {};
    for (const record of records.filter(r => r.extraction.recordType === recordType)) {
      const month = monthKey(zoteroDate(record.data.dateAdded));
      months[recordType][month] = (months[recordType][month] ?? 0) + 1;
    }
  }
  return months;
}

test('a survey counts the items a run reads of each record type, and when they were added', async t => {
  const input = fixture(t);
  // The limit is ignored.
  const { records } = await extractAndSurvey({ input });
  const { survey } = await extractAndSurvey({ input, limit: 1 });
  assert.deepEqual(survey, surveyOf(records));
  // By month when asked, by when each was added.
  const byMonth = (await extractAndSurvey({ input }, { byMonth: true })).survey;
  assert.deepEqual(
    Object.fromEntries(Object.entries(byMonth).map(([type, kind]) => [type, kind.byMonth])),
    monthsOf(records)
  );

  // since is on each item's dateModified, as a run's is.
  const since = new Date('2025-01-12T00:00:00Z');
  const later = await extractAndSurvey({ input, since });
  assert.deepEqual(later.survey, surveyOf(later.records));
  assert.equal(later.survey.works.count, 1);
});

/** Copies the extractor made of a locked database, by its naming scheme. */
function lockedCopies() {
  return readdirSync(tmpdir()).filter(f => /^zotero-[0-9a-f-]{36}\.sqlite$/.test(f));
}

/** A home folder whose Zotero profile names a data folder, or uses the default. */
function home(t, prefs) {
  const dir = mkdtempSync(join(tmpdir(), 'zotero-home-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const profile = join(dir, 'Library', 'Application Support', 'Zotero', 'Profiles', 'a1.default');
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, 'prefs.js'), prefs);
  return dir;
}

test('the data folder is the one the preferences name, else ~/Zotero, and a scan finds it', async t => {
  const moved = home(
    t,
    'user_pref("extensions.zotero.dataDir", "/Papers/Library");\n' +
      'user_pref("extensions.zotero.useDataDir", true);\n'
  );
  assert.equal(zoteroDataDir(moved), '/Papers/Library');
  // A folder named but not in use, or none named: the default.
  const unused = home(t, 'user_pref("extensions.zotero.dataDir", "/Papers/Library");\n');
  assert.equal(zoteroDataDir(unused), join(unused, 'Zotero'));
  const none = mkdtempSync(join(tmpdir(), 'zotero-none-'));
  t.after(() => rmSync(none, { recursive: true, force: true }));
  assert.equal(zoteroDataDir(none), join(none, 'Zotero'));

  // The locator offers the named library, and one left in ~/Zotero.
  const locator = new ZoteroLocator({ home: moved, platform: 'darwin', env: {} });
  const leftover = join(moved, 'Zotero', 'zotero.sqlite');
  const found = await Array.fromAsync(locator.locate([{ path: leftover, options: {} }]));
  assert.deepEqual(found, [
    { config: { input: '/Papers/Library' }, path: '/Papers/Library/zotero.sqlite' },
    { config: { input: join(moved, 'Zotero') }, path: leftover },
  ]);
});

test('a library locked by a running Zotero is read from a copy', async t => {
  const dir = fixture(t);
  // Zotero holds its database in exclusive locking mode while it runs.
  const lock = new DatabaseSync(join(dir, 'zotero.sqlite'));
  lock.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;');
  t.after(() => lock.close());

  const before = lockedCopies();
  const out = await actions({ input: dir });
  assert.equal(out.length, 13);
  // The copy is removed at teardown, and the copy's mtime doesn't leak into
  // the records.
  assert.deepEqual(lockedCopies(), before);
  assert.ok(out.every(a => a['@assertedAt'] === assertedAt));
});
