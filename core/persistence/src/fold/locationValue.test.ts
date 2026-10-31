import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { serializeSchema } from '../serialize/schema.js';

// A Location value (a keyless StructuredValue) on a location slot is content-interned:
// shred content-interns it into location_values (not sourced_entities), and the
// referring entity links to it through an observation row. These tests
// exercise that whole path.

const agent = {
  '@type': 'Person',
  source: 'arc',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};

const visit = (sourceId: string, timestamp: string, location: Record<string, unknown>) => ({
  '@type': 'VisitAction',
  source: 'arc',
  sourceId,
  '@key': ['@type', 'source', 'sourceId'],
  agent,
  timestamp,
  '@assertedAt': timestamp, // event-native: witnessed as it occurs
  object: {
    '@type': 'Venue',
    source: 'arc',
    sourceId: 'v1',
    '@key': ['@type', 'source', 'sourceId'],
    name: '1Rg',
    location, // Location value → location_values
  },
});

const geo = (address: string) => ({
  '@type': 'Location',
  latitude: 43.66,
  longitude: -79.45,
  address,
});

describe('location values', () => {
  it('interns a keyless location node and links the entity to it', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        visit('a1', '2024-01-01T00:00:00Z', geo('2567 Dundas St W, Toronto')),
      ]);

      // one location_values row, raw payload + generated coordinates
      const rows = sqlite
        .prepare('SELECT payload, latitude, longitude, country_id FROM location_values')
        .all() as Array<{ payload: string; latitude: number; longitude: number; country_id: null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].latitude).toBeCloseTo(43.66);
      expect(rows[0].longitude).toBeCloseTo(-79.45);
      expect(rows[0].country_id).toBeNull(); // geocoder not run
      expect(JSON.parse(rows[0].payload)).toEqual({
        address: '2567 Dundas St W, Toronto',
        latitude: 43.66,
        longitude: -79.45,
      });

      // the Venue is still an entity; its location is an observed location ref
      const venue = sqlite
        .prepare(
          `SELECT value_location_id FROM properties p JOIN sourced_entities se ON se.id = p.sourced_entity_id
           WHERE se.type = 'Venue' AND p.predicate = 'location'`
        )
        .all() as Array<{ value_location_id: number | null }>;
      expect(venue).toHaveLength(1);
      expect(venue[0].value_location_id).not.toBeNull();

      // serializes back as the nested geo object
      const v = serializeSchema(db).find(e => e['@type'].includes('Venue'))!;
      expect(v.name).toBe('1Rg');
      expect(v.location).toEqual({
        address: '2567 Dundas St W, Toronto',
        latitude: 43.66,
        longitude: -79.45,
      });
    } finally {
      close();
    }
  });

  it('a changed address re-points the location chain as a new run', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        visit('a1', '2024-01-01T00:00:00Z', geo('123 Old St')),
        visit('a2', '2024-06-01T00:00:00Z', geo('500 New Ave')),
      ]);

      // two distinct immutable location values
      expect(
        (sqlite.prepare('SELECT count(*) AS n FROM location_values').get() as { n: number }).n
      ).toBe(2);

      // the Venue.location chain has two runs: the old one closed, the new open
      const runs = sqlite
        .prepare(
          `SELECT cached_period_to FROM properties p JOIN sourced_entities se ON se.id = p.sourced_entity_id
           WHERE se.type = 'Venue' AND p.predicate = 'location' ORDER BY first_observed_valid_at`
        )
        .all() as Array<{ cached_period_to: number | null }>;
      expect(runs).toHaveLength(2);
      expect(runs[0].cached_period_to).not.toBeNull(); // old address closed
      expect(runs[1].cached_period_to).toBeNull(); // current address open

      // current serialized location is the new address
      const v = serializeSchema(db).find(e => e['@type'].includes('Venue'))!;
      expect((v.location as { address: string }).address).toBe('500 New Ave');
    } finally {
      close();
    }
  });

  it("an action's location is a single FK to its location value (a point)", async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        {
          '@type': 'ReadAction',
          source: 'app',
          sourceId: 'r1',
          '@key': ['@type', 'source', 'sourceId'],
          agent,
          timestamp: '2024-01-01T00:00:00Z',
          location: { '@type': 'Location', latitude: 1.5, longitude: 2.5 },
        },
      ]);

      const row = sqlite
        .prepare(
          `SELECT lv.latitude, lv.longitude FROM actions a
           JOIN location_values lv ON lv.id = a.location_location_id
           WHERE a.type = 'ReadAction'`
        )
        .get() as { latitude: number; longitude: number } | undefined;
      expect(row).toBeDefined();
      expect(row!.latitude).toBeCloseTo(1.5);
      expect(row!.longitude).toBeCloseTo(2.5);
    } finally {
      close();
    }
  });

  it("a named place in an action's location slot keeps its point and up-links the place", async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // `location` ranges over Place too, so a producer may hand the slot a named
      // place entity instead of a bare value. The action must keep a point (the
      // place's own location value) and that value must up-link to the place.
      await processEvents(db, [
        {
          '@type': 'ReadAction',
          source: 'app',
          sourceId: 'r1',
          '@key': ['@type', 'source', 'sourceId'],
          agent,
          timestamp: '2024-01-01T00:00:00Z',
          location: {
            '@type': 'Venue',
            source: 'arc',
            sourceId: 'v1',
            '@key': ['@type', 'source', 'sourceId'],
            name: '1Rg',
            location: geo('2567 Dundas St W, Toronto'),
          },
        },
      ]);

      // the action points at a location value whose entity_id is the Venue
      const row = sqlite
        .prepare(
          `SELECT lv.latitude, lv.cached_entity_id AS entity_id, se.type AS venue_type
           FROM actions a
           JOIN location_values lv ON lv.id = a.location_location_id
           JOIN sourced_entities se ON se.entity_id = lv.cached_entity_id AND se.type = 'Venue'
           WHERE a.type = 'ReadAction'`
        )
        .get() as { latitude: number; entity_id: number; venue_type: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.latitude).toBeCloseTo(43.66);
      expect(row!.entity_id).not.toBeNull();
      expect(row!.venue_type).toBe('Venue');

      // the Venue resolved as a real entity — never silently dropped
      const v = serializeSchema(db).find(e => e['@type'].includes('Venue'))!;
      expect(v.name).toBe('1Rg');
    } finally {
      close();
    }
  });
});
