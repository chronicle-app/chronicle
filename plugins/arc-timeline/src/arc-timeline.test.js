import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ArcTimelineExtractor, ArcTimelineTransformer } from '../dist/index.js';

// An explicit identity keeps the host's iCloud account out of the test.
const identity = 'you@example.com';

const trip = {
  base: {
    id: 'T1',
    startDate: '2025-01-01T23:30:00Z',
    endDate: '2025-01-02T00:30:00Z',
    isVisit: false,
    source: 'LocoKit2',
  },
  trip: { itemId: 'T1', distance: 1200, classifiedActivityType: 2, confirmedActivityType: 4 },
};

// A trip that crosses midnight is in both day files, with its samples split between them.
const days = {
  '2025-01-01': {
    items: [
      {
        base: {
          id: 'V1',
          startDate: '2025-01-01T09:00:00Z',
          endDate: '2025-01-01T10:00:00Z',
          isVisit: true,
          source: 'LocoKit2',
        },
        visit: { itemId: 'V1', placeId: 'P1', latitude: 43.65, longitude: -79.38 },
      },
      {
        base: {
          id: 'D1',
          startDate: '2025-01-01T12:00:00Z',
          endDate: '2025-01-01T13:00:00Z',
          isVisit: true,
          source: 'LocoKit2',
          deleted: true,
        },
        visit: { itemId: 'D1', latitude: 1, longitude: 1 },
      },
      trip,
    ],
    places: [
      {
        id: 'P1',
        name: 'Corner Café',
        latitude: 43.65,
        longitude: -79.38,
        streetAddress: '1 Example St',
        locality: 'Toronto',
        countryCode: 'ca',
        googlePrimaryType: 'cafe',
        foursquarePlaceId: 'fsq-1',
        googlePlaceId: 'gp-1',
      },
    ],
    samples: [
      {
        timelineItemId: 'T1',
        date: '2025-01-01T23:50:00Z',
        latitude: 43.66,
        longitude: -79.39,
        speed: 1.5,
        course: 90,
      },
      {
        timelineItemId: 'T1',
        date: '2025-01-01T23:40:00Z',
        latitude: 43.65,
        longitude: -79.38,
        speed: -1,
        course: -1,
      },
    ],
  },
  '2025-01-02': {
    items: [
      trip,
      {
        base: {
          id: 'V2',
          startDate: '2025-01-02T01:00:00Z',
          endDate: '2025-01-02T02:00:00Z',
          isVisit: true,
          source: 'LocoKit2',
        },
        visit: { itemId: 'V2', latitude: 43.67, longitude: -79.4, streetAddress: '2 Example Ave' },
      },
    ],
    places: [],
    samples: [
      {
        timelineItemId: 'T1',
        date: '2025-01-02T00:10:00Z',
        latitude: 43.67,
        longitude: -79.4,
        speed: 2,
        course: 180,
      },
    ],
  },
};

// The iCloud Exports layout: the day files live under Daily/JSON.
function fixture(t) {
  const exports = mkdtempSync(join(tmpdir(), 'arc-fixture-'));
  t.after(() => rmSync(exports, { recursive: true, force: true }));
  const dir = join(exports, 'Daily', 'JSON');
  mkdirSync(dir, { recursive: true });
  for (const [key, day] of Object.entries(days)) {
    writeFileSync(join(dir, `${key}.json.gz`), gzipSync(JSON.stringify(day)));
  }
  return exports;
}

async function records(input, config = {}) {
  const extractor = new ArcTimelineExtractor({ input, identity, ...config });
  return Array.fromAsync(extractor.extract());
}

async function transform(record) {
  const [node] = await new ArcTimelineTransformer().performTransform(record);
  return node.data;
}

test('visits and trips become schema-valid actions, newest first', async t => {
  const input = fixture(t);
  const rows = await records(input);
  // Deleted D1 is skipped, and T1 is emitted once though both days list it.
  assert.deepEqual(
    rows.map(r => r.data.base.id),
    ['V2', 'T1', 'V1']
  );

  const person = {
    '@type': 'Person',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'icloud',
    sourceId: identity,
    handle: identity,
  };

  const [placeless, travel, visit] = await Promise.all(rows.map(row => transform(row)));
  assert.deepEqual(visit, {
    '@type': 'VisitAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'arc',
    sourceId: 'V1',
    agent: person,
    object: {
      '@type': 'Venue',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'arc',
      sourceId: 'P1',
      name: 'Corner Café',
      location: {
        '@type': 'Location',
        latitude: 43.65,
        longitude: -79.38,
        address: '1 Example St, Toronto, CA',
      },
      category: ['cafe'],
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
          source: 'google-places',
          sourceId: 'gp-1',
          name: 'Corner Café',
        },
      ],
    },
    startTime: new Date('2025-01-01T09:00:00Z'),
    endTime: new Date('2025-01-01T10:00:00Z'),
  });

  // A visit without a place entry is a Place keyed by its coordinates.
  assert.deepEqual(placeless.object, {
    '@type': 'Place',
    '@key': ['@type', 'source', { key: 'lat', value: '43.67' }, { key: 'lng', value: '-79.4' }],
    source: 'arc',
    name: '2 Example Ave',
    location: { '@type': 'Location', latitude: 43.67, longitude: -79.4, address: '2 Example Ave' },
  });

  // The confirmed activity type wins, and the path merges samples from both days in time order.
  const { path, ...journey } = travel.result;
  assert.deepEqual(journey, {
    '@type': 'Journey',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'arc',
    sourceId: 'T1',
    distance: 1200,
    travelMode: 'cycling',
  });
  assert.deepEqual(JSON.parse(path), {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-79.38, 43.65],
        [-79.39, 43.66],
        [-79.4, 43.67],
      ],
    },
    properties: {
      coordTimes: ['2025-01-01T23:40:00Z', '2025-01-01T23:50:00Z', '2025-01-02T00:10:00Z'],
      speeds: [null, 1.5, 2],
      courses: [null, 90, 180],
    },
  });

  // since keeps items starting on or after it; limit keeps the newest.
  const since = new Date('2025-01-01T12:00:00Z');
  assert.deepEqual(
    (await records(input, { since })).map(r => r.data.base.id),
    ['V2', 'T1']
  );
  assert.deepEqual(
    (await records(input, { limit: 1 })).map(r => r.data.base.id),
    ['V2']
  );
});
