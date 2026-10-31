import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';

// The location_values dictionary stores the raw location payload verbatim and
// generates coordinate columns from it; the enrichment columns stay empty until
// a geocoder fills them. These tests exercise the table directly (no shred
// routing or geocoder yet — that is the follow-on engine work).
describe('location_values', () => {
  it('generates coordinates from the payload blob and leaves enrichment empty', () => {
    const { sqlite, close } = makeTestDb();
    try {
      const payload = JSON.stringify({
        latitude: 43.66,
        longitude: -79.45,
        address: '2567 Dundas St W',
      });
      sqlite.prepare('INSERT INTO location_values (key, payload) VALUES (?, ?)').run('k1', payload);

      const row = sqlite
        .prepare(
          'SELECT latitude, longitude, country_id, postal_code FROM location_values WHERE key = ?'
        )
        .get('k1') as { latitude: number; longitude: number; country_id: null; postal_code: null };
      expect(row.latitude).toBeCloseTo(43.66);
      expect(row.longitude).toBeCloseTo(-79.45);
      // enrichment columns are empty until the geocoder fills them
      expect(row.country_id).toBeNull();
      expect(row.postal_code).toBeNull();
    } finally {
      close();
    }
  });

  it('dedupes by content key; coordinates are NULL when the payload has none', () => {
    const { sqlite, close } = makeTestDb();
    try {
      const ins = sqlite.prepare(
        'INSERT INTO location_values (key, payload) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
      );
      ins.run('k', JSON.stringify({ locality: 'Toronto' })); // no coordinates
      ins.run('k', JSON.stringify({ locality: 'Toronto' })); // same key → no-op

      const rows = sqlite
        .prepare('SELECT latitude, longitude FROM location_values WHERE key = ?')
        .all('k') as Array<{ latitude: number | null; longitude: number | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].latitude).toBeNull();
      expect(rows[0].longitude).toBeNull();
    } finally {
      close();
    }
  });

  it('enrichment columns reference real entities (FK-checked) without changing the key', () => {
    const { sqlite, close } = makeTestDb();
    try {
      const country = Number(
        (
          sqlite
            .prepare("INSERT INTO entities (cached_name) VALUES ('Canada') RETURNING id")
            .get() as {
            id: number;
          }
        ).id
      );
      sqlite
        .prepare('INSERT INTO location_values (key, payload) VALUES (?, ?)')
        .run('k', JSON.stringify({ latitude: 43.6, longitude: -79.4 }));

      // geocoder later fills the derived columns; identity (key) is untouched
      sqlite
        .prepare(
          'UPDATE location_values SET country_id = ?, geocoded_by = ?, gazetteer_ver = ? WHERE key = ?'
        )
        .run(country, 'geonames', 'geonames@2026-06', 'k');

      const row = sqlite
        .prepare('SELECT key, country_id, geocoded_by FROM location_values WHERE key = ?')
        .get('k') as { key: string; country_id: number; geocoded_by: string };
      expect(row.key).toBe('k');
      expect(row.country_id).toBe(country);
      expect(row.geocoded_by).toBe('geonames');

      // a dangling FK is rejected
      expect(() =>
        sqlite.prepare('UPDATE location_values SET country_id = 99999 WHERE key = ?').run('k')
      ).toThrow();
    } finally {
      close();
    }
  });
});
