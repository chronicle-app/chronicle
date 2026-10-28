import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { formatInstant } from '../time.js';
import { chunked, entityContentIris, entityTypesFor } from './entityIris.js';

export interface PropertyFact {
  /** literal value, or null for entity-valued facts */
  value: unknown | null;
  /** content IRI of the referenced entity, for entity-valued facts */
  ref?: string;
  /** content IRI of the acting agent, for special-property facts */
  agent?: string;
  source: string;
  periodFrom: string | null;
  periodTo: string | null;
  firstObserved: string | null;
  lastConfirmed: string | null;
}

export interface EntityProjection {
  id: string; // content IRI
  types: string[];
  name?: string;
  properties: Record<string, PropertyFact[]>;
}

interface Row {
  predicate: string;
  literalBody: string | null;
  objectEntityId: number | null;
  agentEntityId: number | null;
  hasAgent: number;
  entityId: number;
  source: string;
  periodFrom: number | null;
  periodTo: number | null;
  firstObservedAt: number;
  lastConfirmedAt: number;
}

const iso = (ms: number | null) => (ms === null ? null : formatInstant(ms));

/**
 * The projection as readable JSON: entities keyed by content IRI, each with its
 * type set and its derived validity runs (period bounds plus the sighting
 * anchors that are their error bars).
 */
export interface ProjectionOptions {
  /** Restrict the projection to these entity ids (e.g. query results). */
  entityIds?: number[];
}

export function serializeProjection(db: Db, options: ProjectionOptions = {}): EntityProjection[] {
  const filter = options.entityIds === undefined ? undefined : new Set(options.entityIds);

  const select = (where: ReturnType<typeof sql>) =>
    db.all<Row>(sql`
      SELECT
        p.predicate                    AS predicate,
        v.body                         AS literalBody,
        p.cached_object_entity_id             AS objectEntityId,
        p.cached_agent_entity_id              AS agentEntityId,
        CASE WHEN p.agent_sourced_id IS NULL THEN 0 ELSE 1 END AS hasAgent,
        p.cached_entity_id                    AS entityId,
        se.source                      AS source,
        p.cached_period_from                  AS periodFrom,
        p.cached_period_to                    AS periodTo,
        p.first_observed_valid_at      AS firstObservedAt,
        p.last_confirmed_valid_at      AS lastConfirmedAt
      FROM properties p
      JOIN sourced_entities se ON se.id = p.sourced_entity_id
      LEFT JOIN vals v ON v.id = p.value_id
      ${where}
    `);

  const rows =
    filter === undefined
      ? select(sql``)
      : chunked([...filter]).flatMap(chunk =>
          select(
            sql`WHERE p.cached_entity_id IN (${sql.join(
              chunk.map(id => sql`${id}`),
              sql`, `
            )})`
          )
        );

  // IRIs for the projected entities and everything they reference.
  const iriIds = filter === undefined ? undefined : new Set(filter);
  if (iriIds) {
    for (const r of rows) {
      if (r.objectEntityId !== null) iriIds.add(r.objectEntityId);
      if (r.agentEntityId !== null) iriIds.add(r.agentEntityId);
    }
  }
  const iris = entityContentIris(db, iriIds);

  const typesByEntity = entityTypesFor(db, filter === undefined ? undefined : [...filter]);

  const meta = new Map<number, { name: string | null }>();
  const metaQueries =
    filter === undefined
      ? [sql`SELECT e.id AS id, e.cached_name AS name FROM entities e`]
      : chunked([...filter]).map(
          chunk => sql`SELECT e.id AS id, e.cached_name AS name FROM entities e
            WHERE e.id IN (${sql.join(
              chunk.map(id => sql`${id}`),
              sql`, `
            )})`
        );
  for (const q of metaQueries) {
    for (const r of db.all<{
      id: number;
      name: string | null;
    }>(q)) {
      meta.set(r.id, r);
    }
  }

  const byEntity = new Map<number, EntityProjection>();
  const get = (id: number): EntityProjection => {
    let e = byEntity.get(id);
    if (!e) {
      const m = meta.get(id);
      e = {
        id: iris.get(id) ?? `(unresolved:${id})`,
        types: typesByEntity.get(id) ?? [],
        properties: {},
      };
      if (m?.name) e.name = m.name;
      byEntity.set(id, e);
    }
    return e;
  };

  // Seed matched entities so type-only matches (no properties) still appear.
  if (filter) for (const id of filter) get(id);
  else for (const id of meta.keys()) get(id);

  for (const r of rows) {
    if (filter && !filter.has(r.entityId)) continue;
    const entity = get(r.entityId);
    const fact: PropertyFact = {
      value:
        r.objectEntityId === null && r.literalBody !== null && r.hasAgent === 0
          ? (JSON.parse(r.literalBody) as unknown)
          : null,
      source: r.source,
      periodFrom: iso(r.periodFrom),
      periodTo: iso(r.periodTo),
      firstObserved: iso(r.firstObservedAt),
      lastConfirmed: iso(r.lastConfirmedAt),
    };
    if (r.objectEntityId !== null) {
      fact.ref = iris.get(r.objectEntityId) ?? `(unresolved:${r.objectEntityId})`;
    }
    if (r.hasAgent === 1) {
      fact.value = true;
      if (r.agentEntityId !== null) {
        fact.agent = iris.get(r.agentEntityId) ?? `(unresolved:${r.agentEntityId})`;
      }
    }
    (entity.properties[r.predicate] ??= []).push(fact);
  }

  // With an explicit id list, honour its order (e.g. a recency-sorted page);
  // otherwise fall back to a stable order by content IRI.
  if (options.entityIds !== undefined) {
    return options.entityIds
      .map(id => byEntity.get(id))
      .filter((e): e is EntityProjection => e !== undefined);
  }
  return [...byEntity.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}
