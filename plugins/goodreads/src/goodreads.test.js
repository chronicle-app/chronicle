import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoodreadsExtractor } from '../dist/index.js';
import { LIBRARY_CSV } from './fixture.test-helper.js';

function writeLibrary(t, csv = LIBRARY_CSV) {
  const dir = mkdtempSync(join(tmpdir(), 'goodreads-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'goodreads_library_export.csv');
  writeFileSync(input, csv);
  return input;
}

async function actions(config) {
  const extractor = new GoodreadsExtractor(config);
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = extractor.instantiateDefaultTransformer();
    const out = [];
    for (const record of records) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
    return out;
  } finally {
    await extractor.teardown();
  }
}

// Goodreads dates are YYYY/MM/DD and are read as local midnight.
const localDay = (y, m, d) => new Date(y, m - 1, d);

// A snapshot stamps every payload with the run's read time; check it and drop it
// so the rest of the payload can be compared exactly.
function withoutAssertedAt(action, before, after) {
  const { '@assertedAt': assertedAt, ...rest } = action;
  const at = new Date(assertedAt).getTime();
  assert.ok(at >= before && at <= after, `@assertedAt ${assertedAt} is the read time`);
  return rest;
}

const person = name => ({
  '@type': 'Person',
  '@key': ['@type', 'source', 'name'],
  source: 'goodreads',
  name,
  '@asserts': ['*'],
});

const me = {
  '@type': 'Person',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'goodreads',
  sourceId: '1234567',
  name: 'Sam Rivera',
  url: 'https://www.goodreads.com/user/show/1234567',
  sameAs: ['@me'],
  '@asserts': ['*'],
};

const lighthouse = {
  '@type': 'Book',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'goodreads',
  sourceId: '40961427',
  name: 'The Lighthouse Keeper',
  url: 'https://www.goodreads.com/book/show/40961427',
  description: 'Quiet and patient.',
  author: [person('Maya Lindqvist'), person('Tomas Berg')],
  pageCount: 312,
  isPartOf: [
    {
      '@type': 'Collection',
      '@key': ['@type', 'url'],
      source: 'goodreads',
      name: 'favorites',
      url: 'https://www.goodreads.com/review/list/1234567?shelf=favorites',
      '@asserts': ['*'],
    },
    {
      '@type': 'Collection',
      '@key': ['@type', 'url'],
      source: 'goodreads',
      name: 'sea stories',
      url: 'https://www.goodreads.com/review/list/1234567?shelf=sea%20stories',
      '@asserts': ['*'],
    },
  ],
  // The plugin lists isPartOf itself; the snapshot adds '*'.
  '@asserts': ['isPartOf', '*'],
  publisher: [
    {
      '@type': 'Organization',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name: 'Harbor Press',
      '@asserts': ['*'],
    },
  ],
  sameAs: [
    {
      '@type': 'Book',
      '@key': ['source', 'sourceId'],
      source: 'isbn',
      sourceId: '9780000000019',
      name: 'The Lighthouse Keeper',
      '@asserts': ['*'],
    },
  ],
};

test('library rows become schema-valid bookmark, finish, and in-progress actions', async t => {
  const input = writeLibrary(t);
  const before = Date.now();
  const out = await actions({ input, userId: '1234567-sam-rivera', displayName: 'Sam Rivera' });
  const after = Date.now();

  assert.deepEqual(
    out.map(a => [a['@type'], a.object.sourceId]),
    [
      ['BookmarkAction', '40961427'],
      ['CompleteAction', '40961427'],
      ['BookmarkAction', '51234'],
      ['BookmarkAction', '77001'],
      ['ConsumeAction', '77001'],
    ]
  );

  const key = ['@type', 'source', 'object.sourceId', 'timestamp'];
  assert.deepEqual(withoutAssertedAt(out[0], before, after), {
    '@type': 'BookmarkAction',
    '@key': key,
    source: 'goodreads',
    agent: me,
    object: lighthouse,
    timestamp: localDay(2025, 1, 20),
    '@asserts': ['*'],
  });
  assert.deepEqual(withoutAssertedAt(out[1], before, after), {
    '@type': 'CompleteAction',
    '@key': key,
    source: 'goodreads',
    agent: me,
    object: lighthouse,
    timestamp: localDay(2025, 3, 14),
    '@asserts': ['*'],
  });

  // A to-read book is only bookmarked. It has no custom shelves, review, ISBN,
  // or page count, so none of those appear.
  assert.deepEqual(withoutAssertedAt(out[2], before, after), {
    '@type': 'BookmarkAction',
    '@key': key,
    source: 'goodreads',
    agent: me,
    object: {
      '@type': 'Book',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'goodreads',
      sourceId: '51234',
      name: 'Field Notes on Tides',
      url: 'https://www.goodreads.com/book/show/51234',
      author: [person('Ines Okafor')],
      publisher: [
        {
          '@type': 'Organization',
          '@key': ['@type', 'source', 'name'],
          source: 'goodreads',
          name: 'Tidewater Books',
          '@asserts': ['*'],
        },
      ],
      '@asserts': ['*'],
    },
    timestamp: localDay(2025, 6, 2),
    '@asserts': ['*'],
  });

  // An in-progress shelf is an undated ConsumeAction.
  assert.deepEqual(withoutAssertedAt(out[4], before, after), {
    '@type': 'ConsumeAction',
    '@key': ['@type', 'source', 'object.sourceId'],
    source: 'goodreads',
    agent: me,
    object: out[3].object,
    '@asserts': ['*'],
  });
});

test('without a user id, the reader and shelves are keyed by name', async t => {
  const input = writeLibrary(t);
  const out = await actions({ input });
  const [bookmark] = out;
  assert.deepEqual(bookmark.agent, {
    '@type': 'Person',
    '@key': ['@type', 'source', 'name'],
    source: 'goodreads',
    name: 'Unknown User',
    sameAs: ['@me'],
    '@asserts': ['*'],
  });
  assert.deepEqual(bookmark.object.isPartOf, [
    {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name: 'favorites',
      '@asserts': ['*'],
    },
    {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name: 'sea stories',
      '@asserts': ['*'],
    },
  ]);
});
