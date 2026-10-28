import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeTestDb } from '../testing/testDb.js';
import { entities, sourcedEntities } from './schema.js';

describe('database harness', () => {
  it('applies the schema and lists all expected tables', () => {
    const { sqlite, close } = makeTestDb();
    try {
      const tables = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'entity_fts%' ORDER BY name"
        )
        .all()
        .map((r: any) => r.name);
      expect(tables).toEqual([
        'action_role_edges',
        'actions',
        'assertion_payloads',
        'assertions',
        'attachments',
        'encounters',
        'entities',
        'entity_types',
        'location_values',
        'meta',
        'metrics',
        'observations',
        'properties',
        'sourced_entities',
        'vals',
      ]);
    } finally {
      close();
    }
  });

  it('keeps the machinery in the ops sidecar, out of the graph', () => {
    const { opsSqlite, close } = makeTestDb();
    try {
      const tables = opsSqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all()
        .map((r: any) => r.name);
      expect(tables).toEqual([
        'blob_cache',
        'connections',
        'inbox',
        'meta',
        'receipts',
        'sync_state',
      ]);
    } finally {
      close();
    }
  });

  it('supports SQLite JSONB functions (>= 3.45)', () => {
    const { sqlite, close } = makeTestDb();
    try {
      const row = sqlite.prepare('SELECT json(jsonb(?)) AS out').get('{"b":2,"a":1}') as {
        out: string;
      };
      expect(JSON.parse(row.out)).toEqual({ b: 2, a: 1 });
    } finally {
      close();
    }
  });

  it('round-trips a JSON column through Drizzle', () => {
    const { db, close } = makeTestDb();
    try {
      const keyset = { source: 'test', sourceId: 'p1' };
      const entity = db.insert(entities).values({}).returning({ id: entities.id }).get();
      const [inserted] = db
        .insert(sourcedEntities)
        .values({ key: 'k1', entityId: entity.id, source: 'test', keyset, type: 'Person' })
        .returning()
        .all();
      const fetched = db
        .select()
        .from(sourcedEntities)
        .where(eq(sourcedEntities.id, inserted.id))
        .get();
      expect(fetched?.keyset).toEqual(keyset);
    } finally {
      close();
    }
  });

  it('keeps the observations identity index placement-major', () => {
    const { sqlite, close } = makeTestDb();
    try {
      // The unique identity index is the merge protocol (INSERT OR IGNORE)
      // and the chain-scan access path: it must lead with (subject, predicate,
      // valid_at, observed_at).
      const index = sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='index' AND name='observations_identity'"
        )
        .get() as { sql: string } | undefined;
      expect(index?.sql).toMatch(/subject_id,\s*predicate,\s*valid_at,\s*observed_at/);
    } finally {
      close();
    }
  });

  it('enforces foreign keys on derived references', () => {
    const { sqlite, close } = makeTestDb();
    try {
      expect(
        (sqlite.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0].foreign_keys
      ).toBe(1);
      // a dangling harmonization pointer is a fold bug — the FK rejects it
      expect(() =>
        sqlite
          .prepare(
            "INSERT INTO sourced_entities (key, entity_id, source, keyset, type) VALUES ('k-dangling', 999, 'test', '{}', 'Person')"
          )
          .run()
      ).toThrow(/FOREIGN KEY/);

      // the merge-rewritten caches are constrained too (belt and suspenders);
      // pin the full reference map so a dropped FK shows up as a diff here.
      const fks = (table: string): string[] =>
        (sqlite.pragma(`foreign_key_list(${table})`) as Array<{ from: string; table: string }>)
          .map(f => `${f.from}->${f.table}`)
          .sort();
      expect(fks('observations')).toEqual([
        'action_id->actions',
        'assertion_id->assertions',
        'subject_id->sourced_entities',
        'value_id->vals',
        'value_location_id->location_values',
        'value_sourced_id->sourced_entities',
      ]);
      expect(fks('properties')).toEqual([
        'agent_sourced_id->sourced_entities',
        'cached_agent_entity_id->entities',
        'cached_entity_id->entities',
        'cached_object_entity_id->entities',
        'closing_action_id->actions',
        'first_observed_action_id->actions',
        'last_confirmed_action_id->actions',
        'originator_action_id->actions',
        'sourced_entity_id->sourced_entities',
        'value_id->vals',
        'value_location_id->location_values',
        'value_sourced_id->sourced_entities',
      ]);
      expect(fks('entities')).toEqual([]);
      expect(fks('metrics')).toEqual([
        'action_id->actions',
        'cached_entity_id->entities',
        'sourced_entity_id->sourced_entities',
      ]);
      expect(fks('actions')).toEqual([
        'agent_sourced_id->sourced_entities',
        'cached_agent_entity_id->entities',
        'cached_instrument_entity_id->entities',
        'cached_object_entity_id->entities',
        'cached_result_entity_id->entities',
        'cached_target_entity_id->entities',
        'founding_assertion_cid->assertions',
        'instrument_sourced_id->sourced_entities',
        'location_location_id->location_values',
        'object_sourced_id->sourced_entities',
        'result_sourced_id->sourced_entities',
        'target_sourced_id->sourced_entities',
      ]);
    } finally {
      close();
    }
  });
});
