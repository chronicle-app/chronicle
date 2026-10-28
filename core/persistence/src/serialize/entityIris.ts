import { sql } from 'drizzle-orm';
import type { Db } from '../db/open.js';
import { entityIri } from './contentIri.js';

/**
 * Map each entity id to its stable content IRI (the lexicographically smallest
 * keyset content key). Shared by every serializer so entity identity is derived
 * from content, never surrogate ids — identical across orderings and merges.
 *
 * Pass `entityIds` to bound the lookup to the entities a page actually
 * references instead of loading every keyset in the store.
 */
export function entityContentIris(db: Db, entityIds?: Iterable<number>): Map<number, string> {
  const ids = entityIds === undefined ? undefined : [...new Set(entityIds)];
  const minKey = new Map<number, string>();
  if (ids === undefined) {
    collectMinKeys(db, sql`SELECT entity_id AS entityId, key AS key FROM sourced_entities`, minKey);
  } else if (ids.length > 0) {
    for (const chunk of chunked(ids)) {
      collectMinKeys(
        db,
        sql`SELECT entity_id AS entityId, key AS key FROM sourced_entities
            WHERE entity_id IN (${sql.join(
              chunk.map(id => sql`${id}`),
              sql`, `
            )})`,
        minKey
      );
    }
  }
  const iris = new Map<number, string>();
  for (const [id, key] of minKey) iris.set(id, entityIri(key));
  return iris;
}

function collectMinKeys(db: Db, query: ReturnType<typeof sql>, minKey: Map<number, string>): void {
  for (const { entityId, key } of db.all<{ entityId: number; key: string }>(query)) {
    const cur = minKey.get(entityId);
    if (cur === undefined || key < cur) minKey.set(entityId, key);
  }
}

/**
 * Map each of the given entity ids to its lexicographically smallest
 * `sourced_entities.key` — the same content key {@link entityContentIris} derives
 * an IRI from, batched and bounded to exactly the ids asked for. This is the
 * durable content handle for a merged entity: identity derived from content,
 * never a surrogate row id. An id with no sourced rows is absent from the map
 * (the caller supplies a fallback).
 */
export function entityMinKeys(db: Db, entityIds: Iterable<number>): Map<number, string> {
  const ids = [...new Set(entityIds)];
  const minKey = new Map<number, string>();
  if (ids.length === 0) return minKey;
  for (const chunk of chunked(ids)) {
    collectMinKeys(
      db,
      sql`SELECT entity_id AS entityId, key AS key FROM sourced_entities
          WHERE entity_id IN (${sql.join(
            chunk.map(id => sql`${id}`),
            sql`, `
          )})`,
      minKey
    );
  }
  return minKey;
}

/** Split an id list into chunks that stay well under SQLite's variable limit. */
export function chunked<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Type unions per entity, optionally bounded to the given ids (sorted, as the
 * serializers expect).
 */
export function entityTypesFor(db: Db, entityIds?: number[]): Map<number, string[]> {
  const queries =
    entityIds === undefined
      ? [sql`SELECT entity_id AS entityId, type AS type FROM entity_types ORDER BY type`]
      : chunked([...new Set(entityIds)]).map(
          chunk =>
            sql`SELECT entity_id AS entityId, type AS type FROM entity_types
                WHERE entity_id IN (${sql.join(
                  chunk.map(id => sql`${id}`),
                  sql`, `
                )}) ORDER BY type`
        );
  const typesByEntity = new Map<number, string[]>();
  for (const q of queries) {
    for (const { entityId, type } of db.all<{ entityId: number; type: string }>(q)) {
      const list = typesByEntity.get(entityId) ?? [];
      list.push(type);
      typesByEntity.set(entityId, list);
    }
  }
  return typesByEntity;
}
