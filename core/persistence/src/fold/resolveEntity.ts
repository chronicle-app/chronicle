import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/open.js';
import {
  actions,
  encounters,
  entities,
  entityTypes,
  locationValues,
  properties,
  sourcedEntities,
} from '../db/schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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
      ? tx
          .select({ entityId: sourcedEntities.entityId })
          .from(sourcedEntities)
          .where(inArray(sourcedEntities.key, keysetKeys))
          .all()
      : [];

  const hitEntityIds = [...new Set(hits.map(h => h.entityId))];

  let entityId: number;
  let merged: Resolution['merged'];

  if (hitEntityIds.length === 0) {
    entityId = tx.insert(entities).values({}).returning({ id: entities.id }).get().id;
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
    tx.insert(entityTypes).values({ entityId, type }).onConflictDoNothing().run();
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
      .select({ key: sourcedEntities.key })
      .from(sourcedEntities)
      .where(eq(sourcedEntities.entityId, id))
      .all()
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
    tx.update(sourcedEntities)
      .set({ entityId: survivor })
      .where(eq(sourcedEntities.entityId, loser))
      .run();
    // type union: move loser types onto survivor, ignoring dupes, then drop loser's
    tx.run(
      sql`INSERT OR IGNORE INTO entity_types (entity_id, type)
          SELECT ${survivor}, type FROM entity_types WHERE entity_id = ${loser}`
    );
    tx.delete(entityTypes).where(eq(entityTypes.entityId, loser)).run();
    // caches
    tx.update(properties).set({ entityId: survivor }).where(eq(properties.entityId, loser)).run();
    // entity-valued property references pointing at the loser
    tx.update(properties)
      .set({ objectEntityId: survivor })
      .where(eq(properties.objectEntityId, loser))
      .run();
    tx.update(properties)
      .set({ agentEntityId: survivor })
      .where(eq(properties.agentEntityId, loser))
      .run();
    tx.run(
      sql`UPDATE metrics SET cached_entity_id = ${survivor} WHERE cached_entity_id = ${loser}`
    );
    // loser-keyed projections (the survivor's are refreshed by the fold)
    tx.run(sql`DELETE FROM entity_fts WHERE rowid = ${loser}`);
    tx.update(actions)
      .set({ agentEntityId: survivor })
      .where(eq(actions.agentEntityId, loser))
      .run();
    tx.update(actions)
      .set({ objectEntityId: survivor })
      .where(eq(actions.objectEntityId, loser))
      .run();
    // The location up-link is an entity cache too: a merged-away named place
    // moves to the survivor.
    tx.update(locationValues)
      .set({ entityId: survivor })
      .where(eq(locationValues.entityId, loser))
      .run();
    tx.update(actions)
      .set({ resultEntityId: survivor })
      .where(eq(actions.resultEntityId, loser))
      .run();
    tx.update(actions)
      .set({ instrumentEntityId: survivor })
      .where(eq(actions.instrumentEntityId, loser))
      .run();
    tx.update(actions)
      .set({ targetEntityId: survivor })
      .where(eq(actions.targetEntityId, loser))
      .run();
    // Participant edges: rewrite the cache half; sourced_id truth
    // is stable, so the (action, role, sourced) identity never collides.
    tx.run(
      sql`UPDATE action_role_edges SET cached_entity_id = ${survivor} WHERE cached_entity_id = ${loser}`
    );
    // Encounter-log entity caches: rewrite the cache halves only; the
    // _sourced_id truth columns point at stable sourced_entities rows. Duplicate
    // rows the merge may produce are correct (two real events).
    tx.update(encounters)
      .set({ subjectEntityId: survivor })
      .where(eq(encounters.subjectEntityId, loser))
      .run();
    tx.update(encounters)
      .set({ encountererEntityId: survivor })
      .where(eq(encounters.encountererEntityId, loser))
      .run();
    // the convergence point itself
    tx.delete(entities).where(eq(entities.id, loser)).run();
  }

  return { survivor, losers, referrers: [...referrers] };
}
