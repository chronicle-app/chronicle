import type { Tx } from '../db/driver.js';
import { sql } from '../db/sql.js';

export interface Resolution {
  entityId: number;
  merged?: { survivor: number; losers: number[]; referrers: number[] };
}

/**
 * Resolve an entity from its keyset content keys, merging when keys that were
 * previously distinct now co-occur. Pure function of the keyset-sharing graph:
 * the partition (connected components) does not depend on arrival order.
 *
 *  - all miss  -> new entity
 *  - one hit   -> attach
 *  - many hits -> UNION merge (content-deterministic survivor)
 *
 * The key->entity index IS `sourced_entities.key` (every keyset is materialized
 * as a sourced entity, incl. the mechanical `{url}` node), so the caller must
 * upsert a sourced entity for each key it passes here. After resolving, the
 * entity's type set is unioned.
 */
export function resolveEntity(tx: Tx, keysetKeys: string[], types: string[]): Resolution {
  const hits =
    keysetKeys.length > 0
      ? tx.all<{ entityId: number }>(
          sql`SELECT entity_id AS entityId FROM sourced_entities WHERE key IN ${keysetKeys}`
        )
      : [];

  const hitEntityIds = [...new Set(hits.map(h => h.entityId))];

  let entityId: number;
  let merged: Resolution['merged'];

  if (hitEntityIds.length === 0) {
    entityId = tx.get<{ id: number }>(sql`INSERT INTO entities DEFAULT VALUES RETURNING id`)!.id;
  } else if (hitEntityIds.length === 1) {
    entityId = hitEntityIds[0];
  } else {
    const result = mergeEntities(tx, hitEntityIds);
    entityId = result.survivor;
    merged = result;
  }

  // No separate key registration: the caller's sourced-entity upserts ARE the
  // key->entity index.

  // Union the asserted types.
  for (const type of types) {
    tx.run(
      sql`INSERT INTO entity_types (entity_id, type) VALUES (${entityId}, ${type}) ON CONFLICT DO NOTHING`
    );
  }

  return { entityId, merged };
}

/**
 * Merge several entities into one. Survivor is chosen by content — the entity
 * whose lexicographically smallest registered keyset key is smallest overall —
 * so the choice is independent of insertion order (and of surrogate ids). Loser
 * rows are repointed (the single truth column `sourced_entities.entity_id` plus
 * cache columns) and deleted.
 */
function mergeEntities(
  tx: Tx,
  entityIds: number[]
): { survivor: number; losers: number[]; referrers: number[] } {
  const repKey = new Map<number, string>();
  for (const id of entityIds) {
    const keys = tx
      .all<{ key: string }>(sql`SELECT key FROM sourced_entities WHERE entity_id = ${id}`)
      .map(r => r.key);
    // representative content key for this entity
    repKey.set(id, keys.length > 0 ? keys.reduce((a, b) => (a < b ? a : b)) : '');
  }

  const survivor = entityIds.reduce((best, id) =>
    repKey.get(id)! < repKey.get(best)! ? id : best
  );
  const losers = entityIds.filter(id => id !== survivor);

  // Entities holding a property whose object is a loser: their render caches
  // embed the referenced name, so they must re-elect after the rewrite.
  const referrers = new Set<number>();
  for (const loser of losers) {
    for (const row of tx.all<{ entityId: number }>(
      sql`SELECT DISTINCT cached_entity_id AS entityId FROM properties WHERE cached_object_entity_id = ${loser}`
    )) {
      referrers.add(row.entityId);
    }
  }

  for (const loser of losers) {
    // truth column
    tx.run(sql`UPDATE sourced_entities SET entity_id = ${survivor} WHERE entity_id = ${loser}`);
    // type union: move loser types onto survivor, ignoring dupes, then drop loser's
    tx.run(
      sql`INSERT OR IGNORE INTO entity_types (entity_id, type)
          SELECT ${survivor}, type FROM entity_types WHERE entity_id = ${loser}`
    );
    tx.run(sql`DELETE FROM entity_types WHERE entity_id = ${loser}`);
    // caches
    tx.run(
      sql`UPDATE properties SET cached_entity_id = ${survivor} WHERE cached_entity_id = ${loser}`
    );
    // entity-valued property references pointing at the loser
    tx.run(
      sql`UPDATE properties SET cached_object_entity_id = ${survivor} WHERE cached_object_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE properties SET cached_agent_entity_id = ${survivor} WHERE cached_agent_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE metrics SET cached_entity_id = ${survivor} WHERE cached_entity_id = ${loser}`
    );
    // loser-keyed projections (the survivor's are refreshed by the fold)
    tx.run(sql`DELETE FROM entity_fts WHERE rowid = ${loser}`);
    tx.run(
      sql`UPDATE actions SET cached_agent_entity_id = ${survivor} WHERE cached_agent_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE actions SET cached_object_entity_id = ${survivor} WHERE cached_object_entity_id = ${loser}`
    );
    // The location up-link is an entity cache too: a merged-away named place
    // moves to the survivor.
    tx.run(
      sql`UPDATE location_values SET cached_entity_id = ${survivor} WHERE cached_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE actions SET cached_result_entity_id = ${survivor} WHERE cached_result_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE actions SET cached_instrument_entity_id = ${survivor} WHERE cached_instrument_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE actions SET cached_target_entity_id = ${survivor} WHERE cached_target_entity_id = ${loser}`
    );
    // Participant edges: rewrite the cache half; sourced_id truth
    // is stable, so the (action, role, sourced) identity never collides.
    tx.run(
      sql`UPDATE action_role_edges SET cached_entity_id = ${survivor} WHERE cached_entity_id = ${loser}`
    );
    // Encounter-log entity caches: rewrite the cache halves only; the
    // _sourced_id truth columns point at stable sourced_entities rows. Duplicate
    // rows the merge may produce are correct (two real events).
    tx.run(
      sql`UPDATE encounters SET cached_subject_entity_id = ${survivor} WHERE cached_subject_entity_id = ${loser}`
    );
    tx.run(
      sql`UPDATE encounters SET cached_encounterer_entity_id = ${survivor} WHERE cached_encounterer_entity_id = ${loser}`
    );
    // the convergence point itself
    tx.run(sql`DELETE FROM entities WHERE id = ${loser}`);
  }

  return { survivor, losers, referrers: [...referrers] };
}
