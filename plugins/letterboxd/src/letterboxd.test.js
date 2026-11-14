import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LetterboxdDefaultExtractor,
  LetterboxdReviewsExtractor,
  LetterboxdTransformer,
} from '../dist/index.js';
import { EXPORTED_AT, stubLetterboxd, writeLetterboxdExport } from './fixture.test-helper.js';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'letterboxd-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Every action a run makes, without the marks a snapshot adds to each node. */
async function actions(Extractor, config) {
  const extractor = new Extractor({ limit: 0, ...config });
  const transformer = new LetterboxdTransformer();
  const out = [];
  try {
    await extractor.setup();
    for await (const record of extractor.extract()) {
      for (const node of await transformer.performTransform(record)) out.push(node.data);
    }
  } finally {
    await extractor.teardown();
  }
  return out;
}

function bare(node) {
  if (Array.isArray(node)) return node.map(item => bare(item));
  if (node === null || typeof node !== 'object') return node;
  const { '@asserts': _asserts, '@assertedAt': _assertedAt, ...rest } = node;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, bare(v)]));
}

const byId = ['@type', 'source', 'sourceId'];
const byMemberAndFilm = ['@type', 'source', 'agent.handle', 'object.sourceId'];

const pat = {
  '@type': 'Person',
  source: 'letterboxd',
  handle: 'pat',
  name: 'Pat Example',
  '@key': ['@type', 'source', 'handle'],
  sameAs: ['@me'],
  url: 'https://letterboxd.com/pat/',
};
const patRef = {
  '@type': 'Person',
  '@key': ['@type', 'source', 'handle'],
  source: 'letterboxd',
  handle: 'pat',
};

const film = (sourceId, name, datePublished) => ({
  '@type': 'Movie',
  '@key': byId,
  source: 'letterboxd',
  sourceId,
  name,
  datePublished,
});
const filmRef = sourceId => ({ '@type': 'Movie', '@key': byId, source: 'letterboxd', sourceId });
const lighthouse = film('aB1', 'The Lighthouse Hours', '2019');

test('the export becomes viewings, ratings, a review, a watchlist, and likes', async t => {
  const dir = tempDir(t);
  const input = writeLetterboxdExport(dir);
  const all = await actions(LetterboxdDefaultExtractor, {
    input,
    'film-cache': join(dir, 'films.json'),
  });

  // Dated by the export's own name, so reading it again says nothing new.
  assert.ok(all.every(action => action['@assertedAt'] === EXPORTED_AT));

  const out = bare(all);
  assert.deepEqual(
    out.map(action => [action['@type'], action.timestamp]),
    [
      ['RespondAction', '2025-06-02'],
      ['RespondAction', '2025-06-02'],
      ['WatchAction', '2025-06-01'],
      ['LikeAction', '2025-04-04'],
      ['BookmarkAction', '2025-03-03'],
      ['WatchAction', '2025-02-09'],
      ['RespondAction', '2025-01-05'],
      ['LikeAction', '2025-01-05'],
      ['WatchAction', '2025-01-04'],
      ['WatchAction', undefined],
    ],
    'newest first, and the undated last'
  );

  const watches = out.filter(action => action['@type'] === 'WatchAction');
  assert.deepEqual(watches, [
    // A diary entry, keyed by its own code. A rewatch is one more of them.
    {
      '@type': 'WatchAction',
      '@key': byId,
      source: 'letterboxd',
      sourceId: 'k2BBBB',
      agent: pat,
      object: lighthouse,
      timestamp: '2025-06-01',
    },
    // Two films are Night Shift (1994), so this one is neither: a film by its
    // name and year.
    {
      '@type': 'WatchAction',
      '@key': byId,
      source: 'letterboxd',
      sourceId: 'k3CCCC',
      agent: pat,
      object: {
        '@type': 'Movie',
        '@key': ['@type', 'source', 'name', 'datePublished'],
        source: 'letterboxd',
        name: 'Night Shift',
        datePublished: '1994',
      },
      timestamp: '2025-02-09',
    },
    {
      '@type': 'WatchAction',
      '@key': byId,
      source: 'letterboxd',
      sourceId: 'k1AAAA',
      agent: pat,
      object: lighthouse,
      timestamp: '2025-01-04',
      tags: ['cinema', '35mm'],
    },
    // Marked watched with no diary entry: by member and film, on no day.
    {
      '@type': 'WatchAction',
      '@key': byMemberAndFilm,
      source: 'letterboxd',
      agent: pat,
      object: film('cD2', 'Paper Moons', '2001'),
    },
  ]);

  const responses = out.filter(action => action['@type'] === 'RespondAction');
  assert.deepEqual(
    responses.map(action => [action['@key'], action.result]),
    [
      // The film's rating as it stands.
      [
        byMemberAndFilm,
        {
          '@type': 'Response',
          '@key': ['@type', 'source', 'action.agent.handle', 'action.object.sourceId'],
          source: 'letterboxd',
          ratingValue: 4.5,
          bestRating: 5,
          author: [patRef],
          about: [filmRef('aB1')],
        },
      ],
      // A review carries the rating given with it, so the entry has no rating
      // of its own beside it.
      [
        ['@type', 'source', 'result.sourceId'],
        {
          '@type': 'Comment',
          '@key': byId,
          source: 'letterboxd',
          sourceId: 'k2BBBB',
          body: 'Better the second time, somehow.',
          ratingValue: 4.5,
          bestRating: 5,
          author: [patRef],
          about: [filmRef('aB1')],
        },
      ],
      // The rating given on an earlier entry stays what it was.
      [
        ['@type', 'source', 'result.sourceId'],
        {
          '@type': 'Response',
          '@key': byId,
          source: 'letterboxd',
          sourceId: 'k1AAAA',
          ratingValue: 4,
          bestRating: 5,
          author: [patRef],
          about: [filmRef('aB1')],
        },
      ],
    ]
  );

  assert.deepEqual(
    out.filter(action => ['LikeAction', 'BookmarkAction'].includes(action['@type'])),
    [
      // A liked review is its code alone: the export says nothing else of it.
      {
        '@type': 'LikeAction',
        '@key': byMemberAndFilm,
        source: 'letterboxd',
        agent: pat,
        object: { '@type': 'Comment', '@key': byId, source: 'letterboxd', sourceId: 'm9ZZZZ' },
        timestamp: '2025-04-04',
      },
      {
        '@type': 'BookmarkAction',
        '@key': byMemberAndFilm,
        source: 'letterboxd',
        agent: pat,
        object: film('iJ5', 'Salt Road', '2022'),
        timestamp: '2025-03-03',
      },
      {
        '@type': 'LikeAction',
        '@key': byMemberAndFilm,
        source: 'letterboxd',
        agent: pat,
        object: lighthouse,
        timestamp: '2025-01-05',
      },
    ]
  );
});

test("--film-pages adds a film's address and ids, and keeps them for later runs", async t => {
  const dir = tempDir(t);
  const input = writeLetterboxdExport(dir);
  const cache = join(dir, 'films.json');
  const asked = stubLetterboxd(t);

  const fetched = bare(
    await actions(LetterboxdDefaultExtractor, { input, 'film-pages': true, 'film-cache': cache })
  );
  const withPage = {
    ...lighthouse,
    url: 'https://letterboxd.com/film/the-lighthouse-hours/',
    sameAs: [
      {
        '@type': 'Movie',
        '@key': ['source', 'sourceId'],
        source: 'imdb',
        sourceId: 'tt0000001',
        name: 'The Lighthouse Hours',
      },
      {
        '@type': 'Movie',
        '@key': ['source', 'sourceId'],
        source: 'tmdb',
        sourceId: 'movie/101',
        name: 'The Lighthouse Hours',
      },
    ],
  };
  assert.deepEqual(fetched.find(action => action.sourceId === 'k1AAAA').object, withPage);

  // The diary entry's own link says which Night Shift it was.
  const nightShift = fetched.find(action => action.sourceId === 'k3CCCC').object;
  assert.deepEqual(
    [nightShift['@key'], nightShift.sourceId, nightShift.url, nightShift.sameAs[1].sourceId],
    [byId, 'gH4', 'https://letterboxd.com/film/night-shift-1994/', 'tv/202']
  );

  // Each film is asked for once, however many records name it.
  assert.equal(asked.filter(url => url === 'https://boxd.it/aB1').length, 1);

  // A run of one record type asks only for the films in it, and a run without
  // the flag asks for nothing and still has what was kept.
  asked.length = 0;
  const [review] = bare(await actions(LetterboxdReviewsExtractor, { input, 'film-cache': cache }));
  assert.deepEqual(asked, []);
  assert.deepEqual(review.object, withPage);
});
