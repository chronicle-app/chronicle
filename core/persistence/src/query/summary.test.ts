import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { openDatabase } from '../db/open.js';
import type { OpenResult } from '../db/open.js';
import { processEvents } from '../process.js';
import { lowerQuery } from './cql.js';
import { countActionsBy, countEntitiesBy, summarizeActions, summarizeEntities } from './summary.js';

/**
 * Aggregation in the store: `--count-by` over any dimension and the
 * envelope's summary, both computed in SQL over the full matched set.
 */

const KEY = { '@key': ['source', 'sourceId'] };
const person = (id: string, name: string, self = false) => ({
  '@type': 'Person',
  source: 'chat',
  sourceId: id,
  name,
  ...(self ? { sameAs: ['@me'] } : {}),
  ...KEY,
});
const me = person('me', 'Me', true);
const alice = person('alice', 'Alice');
const bob = person('bob', 'Bob');
const thread = { '@type': 'Thread', source: 'chat', sourceId: 'th', name: 'Book club', ...KEY };

const message = (id: string, at: string, from: object, to: object[], inThread = false) => ({
  '@type': 'MessageAction',
  source: 'chat',
  sourceId: id,
  timestamp: at,
  agent: from,
  object: {
    '@type': 'Message',
    source: 'chat',
    sourceId: `m-${id}`,
    body: `text of ${id}`,
    recipient: to,
    ...(inThread ? { isPartOf: [thread] } : {}),
    ...KEY,
  },
  ...KEY,
});

const venue = (id: string, name: string, lat: number, lon: number) => ({
  '@type': 'Venue',
  source: 'arc',
  sourceId: id,
  name,
  location: { '@type': 'Location', latitude: lat, longitude: lon },
  ...KEY,
});
const cafe = venue('cafe', 'Cafe Toronto', 43.65, -79.38);
const library = venue('lib', 'Library Toronto', 43.67, -79.4);
const bagel = venue('bagel', 'Bagel Montreal', 45.5, -73.57);

const visit = (id: string, place: object, start: string, end: string) => ({
  '@type': 'VisitAction',
  source: 'arc',
  sourceId: id,
  timestamp: start,
  startTime: start,
  endTime: end,
  agent: me,
  object: place,
  ...KEY,
});

const listen = (id: string, at: string, track: string, artist: string) => ({
  '@type': 'ListenAction',
  source: 'lastfm',
  sourceId: id,
  timestamp: at,
  agent: me,
  object: {
    '@type': 'MusicRecording',
    source: 'lastfm',
    sourceId: `t-${track}`,
    name: track,
    artist: [
      { '@type': 'MusicGroup', source: 'lastfm', sourceId: `a-${artist}`, name: artist, ...KEY },
    ],
    ...KEY,
  },
  ...KEY,
});

async function seeded(): Promise<OpenResult> {
  const open = openDatabase({ path: ':memory:' });
  await processEvents(open.db, [
    message('m1', '2024-01-02T10:00:00Z', me, [alice], true),
    message('m2', '2024-01-02T10:05:00Z', alice, [me], true),
    message('m3', '2024-01-03T09:00:00Z', me, [alice, bob]),
    message('m4', '2024-02-10T09:00:00Z', bob, [me]),
    // A January episode at two Toronto venues, then a March episode in Montreal.
    visit('v1', cafe, '2024-01-02T09:00:00Z', '2024-01-02T11:00:00Z'),
    visit('v2', library, '2024-01-03T08:00:00Z', '2024-01-03T12:00:00Z'),
    visit('v3', cafe, '2024-01-04T08:00:00Z', '2024-01-04T08:20:00Z'),
    visit('v4', bagel, '2024-03-15T08:00:00Z', '2024-03-15T09:00:00Z'),
    visit('v5', bagel, '2024-03-16T08:00:00Z', '2024-03-16T09:00:00Z'),
    listen('l1', '2024-01-02T10:30:00Z', 'Joga', 'Bjork'),
    listen('l2', '2024-01-02T10:35:00Z', 'Hyperballad', 'Bjork'),
    listen('l3', '2024-03-15T08:30:00Z', 'Karma Police', 'Radiohead'),
  ]);
  return open;
}

const q = (cql: string) => lowerQuery(parse(cql));
const pairs = (buckets: { key: string; count: number }[]) => buckets.map(b => [b.key, b.count]);

describe('--count-by over any dimension', () => {
  it('buckets by a role slot name, collapsing the ego to @me', async () => {
    const open = await seeded();
    try {
      expect(pairs(countActionsBy(open.sqlite, q('type:MessageAction'), 'agent.name'))).toEqual([
        ['@me', 2],
        ['Alice', 1],
        ['Bob', 1],
      ]);
    } finally {
      open.close();
    }
  });

  it('walks a predicate off the subject: object.recipient.name, object.isPartOf.name, object.artist.name', async () => {
    const open = await seeded();
    try {
      expect(
        pairs(countActionsBy(open.sqlite, q('type:MessageAction'), 'object.recipient.name'))
      ).toEqual([
        ['@me', 2],
        ['Alice', 2],
        ['Bob', 1],
      ]);
      expect(
        pairs(countActionsBy(open.sqlite, q('type:MessageAction'), 'object.isPartOf.name'))
      ).toEqual([['Book club', 2]]);
      // A family anchor (`involvement`) reaches its concrete member (`recipient`).
      expect(
        pairs(countActionsBy(open.sqlite, q('type:MessageAction'), 'object.involvement.name'))
      ).toEqual([
        ['@me', 2],
        ['Alice', 2],
        ['Bob', 1],
      ]);
      expect(
        pairs(countActionsBy(open.sqlite, q('type:ListenAction'), 'object.artist.name'))
      ).toEqual([
        ['Bjork', 2],
        ['Radiohead', 1],
      ]);
      // An entity-valued terminal is its target's name.
      expect(pairs(countActionsBy(open.sqlite, q('type:ListenAction'), 'object.artist'))).toEqual([
        ['Bjork', 2],
        ['Radiohead', 1],
      ]);
    } finally {
      open.close();
    }
  });

  it('buckets by @type and by a literal predicate', async () => {
    const open = await seeded();
    try {
      expect(pairs(countActionsBy(open.sqlite, q('timestamp:2024'), 'object.@type'))).toEqual([
        ['Venue', 5],
        ['Message', 4],
        ['MusicRecording', 3],
      ]);
      expect(
        pairs(countActionsBy(open.sqlite, q('type:MessageAction'), 'object.body'))
      ).toHaveLength(4);
    } finally {
      open.close();
    }
  });

  it('splits episodes on a time gap, naming each by its date range and top object', async () => {
    const open = await seeded();
    try {
      expect(
        pairs(countActionsBy(open.sqlite, q('type:VisitAction'), 'timestamp:gap(3d)'))
      ).toEqual([
        ['2024-01-02..2024-01-04 · Cafe Toronto', 3],
        ['2024-03-15..2024-03-16 · Bagel Montreal', 2],
      ]);
    } finally {
      open.close();
    }
  });

  it('buckets located actions into geographic cells', async () => {
    const open = await seeded();
    try {
      const areas = pairs(countActionsBy(open.sqlite, q('type:VisitAction'), 'location:geo(50km)'));
      expect(areas).toHaveLength(2);
      expect(areas[0]).toEqual([expect.stringContaining('· Cafe Toronto'), 3]);
      expect(areas[1]).toEqual([expect.stringContaining('· Bagel Montreal'), 2]);
    } finally {
      open.close();
    }
  });

  it('keeps the column and time-bucket dimensions', async () => {
    const open = await seeded();
    try {
      expect(pairs(countActionsBy(open.sqlite, q('timestamp:2024'), 'timestamp:month'))).toEqual([
        ['2024-01', 8],
        ['2024-02', 1],
        ['2024-03', 3],
      ]);
      expect(pairs(countActionsBy(open.sqlite, q('timestamp:2024'), 'source'))).toEqual([
        ['arc', 5],
        ['chat', 4],
        ['lastfm', 3],
      ]);
    } finally {
      open.close();
    }
  });

  it('walks predicate paths on an entity root too', async () => {
    const open = await seeded();
    try {
      expect(pairs(countEntitiesBy(open.sqlite, q('type:MusicRecording'), 'artist.name'))).toEqual([
        ['Bjork', 2],
        ['Radiohead', 1],
      ]);
    } finally {
      open.close();
    }
  });

  it('teaches on a dimension that is not one', async () => {
    const open = await seeded();
    try {
      expect(() => countActionsBy(open.sqlite, q('type:MessageAction'), 'nope!')).toThrow(
        /not a dimension/
      );
      expect(() => countActionsBy(open.sqlite, q('type:MessageAction'), 'object.nothing')).toThrow(
        /not a property/
      );
      expect(() => countEntitiesBy(open.sqlite, q('type:Person'), 'timestamp:year')).toThrow(
        /needs an action query/
      );
    } finally {
      open.close();
    }
  });
});

describe('buckets count roots, not assertions', () => {
  it('a recipient two merged sources both assert counts the message once', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      // One message whose Message entity is described by two sources (merged
      // via sameAs), both asserting Alice as recipient.
      const twin = {
        '@type': 'Message',
        source: 'backup',
        sourceId: 'm-twin',
        recipient: [alice],
        ...KEY,
      };
      await processEvents(open.db, [
        {
          '@type': 'MessageAction',
          source: 'chat',
          sourceId: 'dup',
          timestamp: '2024-03-01T10:00:00Z',
          agent: me,
          object: {
            '@type': 'Message',
            source: 'chat',
            sourceId: 'm-dup',
            body: 'hi',
            recipient: [alice],
            sameAs: [twin],
            ...KEY,
          },
          ...KEY,
        },
        {
          '@type': 'MessageAction',
          source: 'backup',
          sourceId: 'dup-backup',
          timestamp: '2024-03-01T10:00:00Z',
          agent: me,
          object: twin,
          ...KEY,
        },
      ]);
      expect(
        pairs(
          countActionsBy(open.sqlite, q('type:MessageAction source:chat'), 'object.recipient.name')
        )
      ).toEqual([['Alice', 1]]);
    } finally {
      open.close();
    }
  });

  it('a single-valued predicate two sources disagree on counts the elected value only', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      const journey = (source: string, mode: string) => ({
        '@type': 'Journey',
        source,
        sourceId: 'j1',
        travelMode: mode,
        ...(source === 'arc'
          ? { sameAs: [{ '@type': 'Journey', source: 'moves', sourceId: 'j1', ...KEY }] }
          : {}),
        ...KEY,
      });
      await processEvents(open.db, [
        {
          '@type': 'TravelAction',
          source: 'arc',
          sourceId: 't1',
          timestamp: '2024-03-02T10:00:00Z',
          '@assertedAt': '2024-03-02T10:00:00Z',
          agent: me,
          result: journey('arc', 'cycling'),
          ...KEY,
        },
        {
          '@type': 'TravelAction',
          source: 'moves',
          sourceId: 't1',
          timestamp: '2024-03-02T10:00:00Z',
          '@assertedAt': '2024-03-03T10:00:00Z',
          agent: me,
          result: journey('moves', 'bike'),
          ...KEY,
        },
      ]);
      const buckets = pairs(
        countActionsBy(open.sqlite, q('type:TravelAction'), 'result.travelMode')
      );
      // Two actions share one merged journey; the facet takes the journey's
      // one elected travelMode for each, never both values.
      expect(buckets).toHaveLength(1);
      expect(buckets[0][1]).toBe(2);
    } finally {
      open.close();
    }
  });
});

describe('the feed window restricts the aggregates like the page', () => {
  it('a from/to window reaches the summary, the facets, and the buckets', async () => {
    const open = await seeded();
    try {
      const from = Date.parse('2024-02-01T00:00:00Z');
      const to = Date.parse('2024-03-01T00:00:00Z');
      const s = summarizeActions(open.sqlite, q('type:MessageAction'), { from, to });
      expect(s.total).toBe(1);
      expect(s.span).toEqual(['2024-02-10', '2024-02-10']);
      expect(
        pairs(countActionsBy(open.sqlite, q('type:MessageAction'), 'agent.name', { from, to }))
      ).toEqual([['Bob', 1]]);
    } finally {
      open.close();
    }
  });
});

describe('the query summary — total, span, facets, census over the full set', () => {
  it('summarizes an action query: span, a time facet, a source facet, footprint facets, and the census', async () => {
    const open = await seeded();
    try {
      const s = summarizeActions(open.sqlite, q('type:MessageAction'));
      expect(s.total).toBe(4);
      expect(s.span).toEqual(['2024-01-02', '2024-02-10']);
      // Under two months of span → day buckets, in key order.
      expect(s.facets['timestamp:day']).toEqual([
        ['2024-01-02', 2],
        ['2024-01-03', 1],
        ['2024-02-10', 1],
      ]);
      // One source only → no source facet.
      expect(s.facets.source).toBeUndefined();
      // Footprint facets: the populated edges that actually group.
      expect(s.facets['agent.name']).toEqual([
        ['@me', 2],
        ['Alice', 1],
        ['Bob', 1],
      ]);
      expect(s.facets['object.recipient.name']).toEqual([
        ['@me', 2],
        ['Alice', 2],
        ['Bob', 1],
      ]);
      // The census: the root's slots (zeros listed), the subject's predicates,
      // and the attachment slot even when empty.
      expect(s.census).toMatchObject({
        timestamp: 4,
        agent: 4,
        object: 4,
        location: 0,
        'object.body': 4,
        'object.recipient': 4,
        'object.isPartOf': 2,
        'object.attachment': 0,
      });
    } finally {
      open.close();
    }
  });

  it('does not repeat a path the query pins to one value', async () => {
    const open = await seeded();
    try {
      const s = summarizeActions(open.sqlite, q('type:MessageAction agent:{ name:"Alice" }'));
      expect(s.total).toBe(1);
      expect(s.facets['agent.name']).toBeUndefined();
      const mine = summarizeActions(open.sqlite, q('type:MessageAction agent:@me'));
      expect(mine.facets['agent.name']).toBeUndefined();
    } finally {
      open.close();
    }
  });

  it('summarizes an empty set as a zero total with no span', async () => {
    const open = await seeded();
    try {
      const s = summarizeActions(open.sqlite, q('type:MessageAction timestamp:2019'));
      expect(s.total).toBe(0);
      expect(s.span).toBeUndefined();
      expect(s.facets).toEqual({});
    } finally {
      open.close();
    }
  });

  it('summarizes an entity query: type and source facets, predicate census', async () => {
    const open = await seeded();
    try {
      const s = summarizeEntities(open.sqlite, q('type:Person'));
      expect(s.total).toBe(3);
      expect(s.span).toBeUndefined();
      expect(s.census.name).toBe(3);
      const songs = summarizeEntities(open.sqlite, q('type:MusicRecording'));
      expect(songs.facets['artist.name']).toEqual([
        ['Bjork', 2],
        ['Radiohead', 1],
      ]);
    } finally {
      open.close();
    }
  });
});
