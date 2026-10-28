/**
 * Worked examples — the canonical event sets the fold must get right. Each is an
 * unordered set; the permutation harness applies them in many orders. They map
 * to the requirements doc's Requests 2/3/4 plus a multi-valued case.
 */

const me = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};

// These are event-native records: a ReadAction is witnessed at the moment it
// happens, so its sighting axis (`@assertedAt`) equals its occurrence
// (`timestamp`). Stamp it explicitly — the fold no longer borrows the occurrence
// for the observed axis, and an unstamped payload would be dated implicit-now
// (wall-clock), breaking permutation determinism. An `over.@assertedAt` wins.
const read = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent: me,
  '@key': ['source', 'sourceId'],
  ...(over.timestamp === undefined ? {} : { '@assertedAt': over.timestamp }),
  ...over,
});

const book = (over: Record<string, unknown>) => ({
  '@type': 'Book',
  source: 'test',
  sourceId: 'book-1',
  '@key': ['source', 'sourceId'],
  ...over,
});

/** WE-1 — single-valued supersession within one source chain. (Request 2) */
export const supersession = [
  read({
    sourceId: 'r1',
    timestamp: '2020-01-01T00:00:00Z',
    object: book({ name: 'Old Title' }),
  }),
  read({
    sourceId: 'r2',
    timestamp: '2020-06-01T00:00:00Z',
    object: book({ name: 'New Title' }),
  }),
];

/** WE-2 — cross-source merge bridged by a shared url keyset. (Request 3) */
export const crossSourceMerge = [
  read({
    sourceId: 'rA',
    timestamp: '2022-01-01T00:00:00Z',
    object: {
      '@type': 'Person',
      source: 'srcA',
      sourceId: 'p1',
      name: 'Jane',
      '@key': ['source', 'sourceId'],
    },
  }),
  read({
    sourceId: 'rB',
    timestamp: '2022-02-01T00:00:00Z',
    object: {
      '@type': 'Person',
      source: 'srcB',
      sourceId: 'p2',
      url: 'https://example.com/jane',
      mood: 'curious',
      '@key': ['source', 'sourceId'],
    },
  }),
  read({
    sourceId: 'rC',
    timestamp: '2022-03-01T00:00:00Z',
    object: {
      '@type': 'Person',
      source: 'srcA',
      sourceId: 'p1',
      url: 'https://example.com/jane',
      '@key': ['source', 'sourceId'],
    },
  }),
];

const group = (over: Record<string, unknown>) => ({
  '@type': 'MusicGroup',
  source: 'test',
  sourceId: 'band-1',
  '@key': ['source', 'sourceId'],
  ...over,
});
const person = (sourceId: string, name: string) => ({
  '@type': 'Person',
  source: 'test',
  sourceId,
  name,
  '@key': ['source', 'sourceId'],
});

/**
 * WE-3 — late-arriving membership. Three multi-valued `member` claims land as
 * separate actions; each member is an independent open timeline anchored to its
 * assertion time, regardless of arrival order. (Request 4)
 */
export const lateMembership = [
  read({
    sourceId: 'm1',
    timestamp: '2024-01-01T00:00:00Z',
    object: group({ member: [person('alice', 'Alice')] }),
  }),
  read({
    sourceId: 'm2',
    timestamp: '2024-02-01T00:00:00Z',
    object: group({ member: [person('bob', 'Bob')] }),
  }),
  read({
    sourceId: 'm3',
    timestamp: '2024-03-01T00:00:00Z',
    object: group({ member: [person('carol', 'Carol')] }),
  }),
];

/** WE-4 — multi-valued independence: two genres coexist, neither closes. */
export const multiValued = [
  read({
    sourceId: 'g1',
    timestamp: '2021-01-01T00:00:00Z',
    object: book({ genre: ['dystopia', 'sci-fi'] }),
  }),
];

/**
 * WE-5 — transitive encounter backfill. A track is listened to
 * with no album metadata, then a later event names its album. Folding the listen
 * first takes the backfill path; folding the album-edge first takes the direct
 * path — both must yield the same `encounters` rows (incl. the album dated at the
 * listen). Exercises the encounter log's order-independence once the ontology
 * declares encounter policies; until then, the rest of the fold's.
 */
const track = (over: Record<string, unknown>) => ({
  '@type': 'MusicRecording',
  source: 'test',
  sourceId: 'trk-1',
  name: 'Song',
  '@key': ['source', 'sourceId'],
  ...over,
});
export const transitiveBackfill = [
  {
    '@type': 'ListenAction',
    source: 'test',
    sourceId: 'lis-1',
    timestamp: '2024-01-01T00:00:00Z',
    '@assertedAt': '2024-01-01T00:00:00Z',
    agent: me,
    object: track({}),
    '@key': ['source', 'sourceId'],
  },
  {
    '@type': 'UpdateAction',
    source: 'test',
    sourceId: 'upd-1',
    timestamp: '2024-02-01T00:00:00Z',
    '@assertedAt': '2024-02-01T00:00:00Z',
    agent: me,
    object: track({
      inAlbum: {
        '@type': 'MusicAlbum',
        source: 'test',
        sourceId: 'alb-1',
        name: 'Album',
        '@key': ['source', 'sourceId'],
      },
    }),
    '@key': ['source', 'sourceId'],
  },
];

/**
 * WE-6 — occurrence narrowing. Two PublishAction sightings share one
 * action keyset; the second reports a finer publication date, so the occurrence
 * register intersects to the day. The `publisher` run opens at the publication
 * (its originator), and its boundary derives THROUGH that anchor — so it must
 * sharpen to the day in every order (coarse-first, fine-first, duplicated,
 * fast/full interleaved), never freeze at the year the first-shredded sighting saw.
 */
const publishedIn = (sourceId: string, timestamp: string, assertedAt: string) => ({
  '@type': 'PublishAction',
  source: 'test',
  sourceId: 'publish-1', // shared key → one action; its occurrence register narrows
  '@key': ['source', 'sourceId'],
  '@assertedAt': assertedAt,
  timestamp,
  object: {
    '@type': 'Book',
    source: 'test',
    sourceId,
    name: 'Something',
    '@key': ['source', 'sourceId'],
  },
  agent: {
    '@type': 'Organization',
    source: 'test',
    sourceId: 'house',
    name: 'A Publishing House',
    '@key': ['source', 'sourceId'],
  },
});
export const occurrenceNarrowing = [
  publishedIn('b-published', '1862', '2024-06-01T00:00:00Z'),
  publishedIn('b-published', '1862-03-30', '2024-07-01T00:00:00Z'),
];

/**
 * WE-7 — state observation. A favorites-list like with no date is a
 * state observation: it lands with an upper-bound-only occurrence ("by then") and
 * opens the `liked` run with an unknown start (period_from NULL), placed for
 * ordering at the sighting. One sighting, so it is order-independent — a re-crawl
 * would land as a confirm, not a competing assert (that tightening is a
 * follow-up). Derived state must be byte-identical in every order.
 */
export const stateObservation = [
  {
    '@type': 'LikeAction',
    source: 'test',
    '@assertedAt': '2024-06-01T00:00:00Z',
    '@key': ['@type', 'source', 'agent', 'object'],
    agent: me,
    object: {
      '@type': 'Agent',
      source: 'test',
      sourceId: 'favorite',
      name: 'Favorite',
      '@key': ['source', 'sourceId'],
    },
  },
];

export const workedExamples = {
  supersession,
  crossSourceMerge,
  lateMembership,
  multiValued,
  transitiveBackfill,
  occurrenceNarrowing,
  stateObservation,
};
