import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { formatInstant } from '../time.js';
import { chunked, entityTypesFor } from './entityIris.js';

/** A query result as plain JSON. */
export type SerializedRow = Record<string, unknown>;

const inList = (ids: number[]) =>
  sql.join(
    ids.map(id => sql`${id}`),
    sql`, `
  );

/** One type as a string, several as an array. */
const typeOf = (types: string[] | undefined) => (types?.length === 1 ? types[0] : types);

/** An entity as a reference: its types and its elected name. */
function references(db: Db, ids: number[]): Map<number, SerializedRow> {
  const unique = [...new Set(ids)];
  const types = entityTypesFor(db, unique);
  const out = new Map<number, SerializedRow>();
  for (const chunk of chunked(unique)) {
    for (const { id, name } of db.all<{ id: number; name: string | null }>(
      sql`SELECT id AS id, cached_name AS name FROM entities WHERE id IN (${inList(chunk)})`
    )) {
      out.set(id, { '@type': typeOf(types.get(id)), ...(name !== null && { name }) });
    }
  }
  return out;
}

interface ValueRow {
  entityId: number;
  predicate: string;
  literal: string | null;
  objectId: number | null;
  location: string | null;
}

/** A run's value: a literal as itself, an entity as a reference, a place as its stored location. */
function valueOf(row: ValueRow, refs: Map<number, SerializedRow>): unknown {
  if (row.literal !== null) return JSON.parse(row.literal);
  if (row.objectId !== null) return refs.get(row.objectId);
  if (row.location !== null) return JSON.parse(row.location);
  // No value: the run records that the value was taken away.
  return undefined;
}

/**
 * Entities with their current values: each predicate's open runs, a literal
 * as itself, a place as its stored location, and an entity as a reference. A
 * predicate with several current values (from several sources, say) lists
 * them all.
 */
function entities(db: Db, ids: number[]): Map<number, SerializedRow> {
  const rows = chunked([...new Set(ids)]).flatMap(chunk =>
    db.all<ValueRow>(sql`
      SELECT p.cached_entity_id AS entityId, p.predicate AS predicate, v.body AS literal,
             p.cached_object_entity_id AS objectId, l.payload AS location
      FROM properties p
      LEFT JOIN vals v ON v.id = p.value_id
      LEFT JOIN location_values l ON l.id = p.value_location_id
      WHERE p.cached_entity_id IN (${inList(chunk)})
        AND p.cached_period_to IS NULL AND p.predicate <> 'name'
      ORDER BY p.predicate, p.id
    `)
  );
  const refs = references(db, [
    ...ids,
    ...rows.flatMap(r => (r.objectId === null ? [] : [r.objectId])),
  ]);

  const values = new Map<number, Map<string, unknown[]>>();
  for (const r of rows) {
    const value = valueOf(r, refs);
    if (value === undefined) continue;
    const byPredicate = values.get(r.entityId) ?? new Map<string, unknown[]>();
    values.set(r.entityId, byPredicate);
    const list = byPredicate.get(r.predicate) ?? [];
    byPredicate.set(r.predicate, list);
    const key = JSON.stringify(value);
    if (!list.some(v => JSON.stringify(v) === key)) list.push(value);
  }

  const out = new Map<number, SerializedRow>();
  for (const id of ids) {
    const fields = [...(values.get(id) ?? [])].map(([predicate, list]) => [
      predicate,
      list.length === 1 ? list[0] : list,
    ]);
    out.set(id, { ...refs.get(id), ...Object.fromEntries(fields) });
  }
  return out;
}

/**
 * Actions with their type, their time (`startTime`/`endTime` when the source
 * gave a span, else `timestamp`), their source, and each role's entities with
 * their current values.
 */
function actions(db: Db, ids: number[]): Map<number, SerializedRow> {
  const rows = chunked(ids).flatMap(chunk =>
    db.all<{
      id: number;
      type: string;
      source: string;
      startTime: number | null;
      endTime: number | null;
      occurredAt: number;
      locationId: number | null;
      location: string | null;
    }>(sql`
      SELECT a.id AS id, a.type AS type, a.source AS source, a.start_time AS startTime,
             a.end_time AS endTime, a.occurred_at AS occurredAt,
             l.cached_entity_id AS locationId, l.payload AS location
      FROM actions a
      LEFT JOIN location_values l ON l.id = a.location_location_id
      WHERE a.id IN (${inList(chunk)})
    `)
  );
  const roles = chunked(ids).flatMap(chunk =>
    db.all<{ actionId: number; role: string; entityId: number }>(sql`
      SELECT action_id AS actionId, role AS role, cached_entity_id AS entityId
      FROM action_role_edges
      WHERE action_id IN (${inList(chunk)})
      ORDER BY role, id
    `)
  );
  const nodes = entities(db, [
    ...roles.map(r => r.entityId),
    ...rows.flatMap(r => (r.locationId === null ? [] : [r.locationId])),
  ]);

  const rolesOf = new Map<number, Map<string, SerializedRow[]>>();
  for (const { actionId, role, entityId } of roles) {
    const byRole = rolesOf.get(actionId) ?? new Map<string, SerializedRow[]>();
    rolesOf.set(actionId, byRole);
    byRole.set(role, [...(byRole.get(role) ?? []), nodes.get(entityId) ?? {}]);
  }

  const out = new Map<number, SerializedRow>();
  for (const row of rows) {
    const byRole = rolesOf.get(row.id) ?? new Map<string, SerializedRow[]>();
    const span = row.startTime !== null || row.endTime !== null;
    // A place the store resolved to an entity, or else the location as given.
    const place = row.location === null ? undefined : JSON.parse(row.location);
    const location = row.locationId === null ? place : nodes.get(row.locationId);
    out.set(row.id, {
      '@type': row.type,
      ...(span
        ? {
            ...(row.startTime !== null && { startTime: formatInstant(row.startTime) }),
            ...(row.endTime !== null && { endTime: formatInstant(row.endTime) }),
          }
        : { timestamp: formatInstant(row.occurredAt) }),
      source: row.source,
      ...Object.fromEntries(
        [...byRole].map(([role, list]) => [role, list.length === 1 ? list[0] : list])
      ),
      ...(location !== undefined && { location }),
    });
  }
  return out;
}

/**
 * A light serialization of query results, one object per id in the order
 * given. An entity is its types, its elected name, and its current values,
 * with an entity value as its types and name. An action is its type, time and
 * source, and each role's entity as an entity is. Fields with no value are
 * left out.
 */
export function serializeRows(
  db: Db,
  target: 'actions' | 'entities',
  ids: number[]
): SerializedRow[] {
  const byId = target === 'actions' ? actions(db, ids) : entities(db, ids);
  return ids.map(id => byId.get(id) ?? {});
}
