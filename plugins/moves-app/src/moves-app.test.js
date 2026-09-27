import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MovesExtractor, MovesTransformer } from '../dist/index.js';
import { parseMovesTime, shiftDayKey } from '../dist/time.js';

const person = {
  '@type': 'Person',
  '@key': ['@type', 'source'],
  source: 'moves-app',
  sameAs: ['@me'],
};

const home = {
  id: 1001,
  name: 'Home',
  type: 'home',
  location: { lat: 43.66, lon: -79.4 },
};

// A stay that crosses midnight is written into both days' files.
const overnight = {
  type: 'place',
  startTime: '20140509T230000-0300',
  endTime: '20140510T080000-0300',
  place: home,
};

const days = {
  'storyline_20140509.json': [
    {
      date: '20140509',
      segments: [
        {
          type: 'place',
          startTime: '20140509T090000-0300',
          endTime: '20140509T100000-0300',
          place: {
            id: 2002,
            name: 'Corner Café',
            type: 'foursquare',
            foursquareId: 'fsq-1',
            facebookPlaceId: 'fb-1',
            location: { lat: 43.65, lon: -79.38 },
          },
        },
        overnight,
      ],
    },
  ],
  'storyline_20140510.json': [
    {
      date: '20140510',
      segments: [
        // The same stay, written at UTC in the next day's file.
        { ...overnight, startTime: '20140510T020000Z', endTime: '20140510T110000Z' },
        {
          type: 'move',
          startTime: '20140510T080000-0300',
          endTime: '20140510T083000-0300',
          activities: [
            {
              activity: 'walking',
              group: 'walking',
              startTime: '20140510T080000-0300',
              endTime: '20140510T081000-0300',
              distance: 700,
              steps: 900,
              trackPoints: [
                { lat: 43.66, lon: -79.4, time: '20140510T080000-0300' },
                { lat: 43.661, lon: -79.401, time: '20140510T081000-0300' },
              ],
            },
            {
              activity: 'underground',
              startTime: '20140510T081000-0300',
              endTime: '20140510T083000-0300',
              distance: 5000,
              trackPoints: [],
            },
          ],
        },
        {
          type: 'place',
          startTime: '20140510T083000-0300',
          endTime: '20140510T170000-0300',
          place: { id: 3003, type: 'unknown', location: { lat: 43.64, lon: -79.39 } },
        },
      ],
    },
  ],
};

// The export layout: one storyline file per day under json/daily/storyline.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'moves-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'json', 'daily', 'storyline');
  mkdirSync(dir, { recursive: true });
  for (const [name, day] of Object.entries(days)) {
    writeFileSync(join(dir, name), JSON.stringify(day));
  }
  return root;
}

async function records(input, config = {}) {
  const extractor = new MovesExtractor({ input, ...config });
  return Array.fromAsync(extractor.extract());
}

async function transform(record) {
  const [node] = await new MovesTransformer().performTransform(record);
  return node.data;
}

const starts = rows => rows.map(r => `${r.context.recordType} ${r.data.startTime}`);

test('stays and legs become schema-valid actions, newest first', async t => {
  const input = fixture(t);
  const rows = await records(input);
  // The overnight stay is emitted once though both days list it. Segments come
  // newest first; the legs of one segment keep their own order.
  assert.deepEqual(starts(rows), [
    'places 20140510T083000-0300',
    'moves 20140510T080000-0300',
    'moves 20140510T081000-0300',
    'places 20140510T020000Z',
    'places 20140509T090000-0300',
  ]);

  const [spot, walk, metro, stay, cafe] = await Promise.all(rows.map(row => transform(row)));

  assert.deepEqual(cafe, {
    '@type': 'VisitAction',
    '@key': ['@type', 'source', { key: 'startTime', value: '2014-05-09T12:00:00.000Z' }],
    source: 'moves-app',
    agent: person,
    object: {
      '@type': 'Venue',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'moves-app',
      sourceId: '2002',
      location: { '@type': 'Location', latitude: 43.65, longitude: -79.38 },
      sameAs: [
        {
          '@type': 'Venue',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'foursquare',
          sourceId: 'fsq-1',
          name: 'Corner Café',
        },
        {
          '@type': 'Venue',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'facebook',
          sourceId: 'fb-1',
          name: 'Corner Café',
        },
      ],
      name: 'Corner Café',
    },
    startTime: '2014-05-09T12:00:00.000Z',
    endTime: '2014-05-09T13:00:00.000Z',
    '@assertedAt': '2014-05-09T12:00:00.000Z',
  });

  // Either day's copy of the overnight stay keys on the same instant.
  assert.deepEqual(stay['@key'], [
    '@type',
    'source',
    { key: 'startTime', value: '2014-05-10T02:00:00.000Z' },
  ]);
  assert.equal(stay.object['@type'], 'Venue');

  // An unnamed spot is a Place on the Moves place id.
  assert.deepEqual(spot.object, {
    '@type': 'Place',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'moves-app',
    sourceId: '3003',
    location: { '@type': 'Location', latitude: 43.64, longitude: -79.39 },
  });

  assert.deepEqual(walk, {
    '@type': 'TravelAction',
    '@key': ['@type', 'source', { key: 'startTime', value: '2014-05-10T11:00:00.000Z' }],
    source: 'moves-app',
    agent: person,
    result: {
      '@type': 'Journey',
      '@key': ['@type', 'source', { key: 'startTime', value: '2014-05-10T11:00:00.000Z' }],
      source: 'moves-app',
      distance: 700,
      travelMode: 'walking',
      path: JSON.stringify({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-79.4, 43.66],
            [-79.401, 43.661],
          ],
        },
        properties: { coordTimes: ['2014-05-10T11:00:00.000Z', '2014-05-10T11:10:00.000Z'] },
      }),
    },
    startTime: '2014-05-10T11:00:00.000Z',
    endTime: '2014-05-10T11:10:00.000Z',
    '@assertedAt': '2014-05-10T11:00:00.000Z',
  });

  // Moves' underground is written metro; a leg without GPS has no path.
  assert.deepEqual(metro.result, {
    '@type': 'Journey',
    '@key': ['@type', 'source', { key: 'startTime', value: '2014-05-10T11:10:00.000Z' }],
    source: 'moves-app',
    distance: 5000,
    travelMode: 'metro',
  });
});

test('reads the full storyline file, and applies since and limit', async t => {
  const root = mkdtempSync(join(tmpdir(), 'moves-full-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'storyline.json');
  writeFileSync(file, JSON.stringify(Object.values(days).flat()));

  assert.equal((await records(file)).length, 5);
  assert.deepEqual(starts(await records(file, { since: new Date('2014-05-10T11:05:00Z') })), [
    'places 20140510T083000-0300',
    'moves 20140510T081000-0300',
  ]);
  assert.deepEqual(starts(await records(file, { limit: 1 })), ['places 20140510T083000-0300']);
  assert.equal(await new MovesExtractor({ input: file, limit: 2 }).determineCount(), 2);

  await assert.rejects(records(join(root, 'missing')), /No Moves storyline found/);
});

test('reads the basic ISO times Moves writes', () => {
  assert.equal(parseMovesTime('20150801T090000+0530')?.toISOString(), '2015-08-01T03:30:00.000Z');
  assert.equal(parseMovesTime('2014-05-10T13:43:49-03:00'), undefined);
  assert.equal(shiftDayKey('20141231', 1), '20150101');
  assert.equal(shiftDayKey('20140501', -1), '20140430');
});
