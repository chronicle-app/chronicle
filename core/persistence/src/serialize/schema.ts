import { sql } from '../db/sql.js';
import type { Db } from '../db/open.js';
import { getPredicateAnnotation } from '../annotations/ontology.js';
import { electWinner } from '../fold/elect.js';
import type { CandidateRow } from '../fold/elect.js';
import {
  getOccurrenceDatePredicate,
  getSpecialPropertyDefs,
  occurrenceDateTypes,
} from '../annotations/actionTypes.js';
import { formatDateRange, formatInstant } from '../time.js';
import { chunked, entityContentIris, entityTypesFor } from './entityIris.js';
import { entityUrls, sourcedHandles } from './keyset.js';
import { resolveImageRefs } from './imageRefs.js';
import type { ActionImageRef } from './imageRefs.js';
import { sourceClusters } from './sources.js';
import type { SourceRecord } from './sources.js';

export type { SourceRecord } from './sources.js';

/** A Chronicle JSON-LD entity: @type (always an array), optional @id, and values. */
export interface SchemaEntity {
  '@id'?: string;
  '@type': string[];
  /** A representative image, resolved like an action's (see `imageRefs`). */
  image?: ActionImageRef;
  [predicate: string]: unknown;
}

/**
 * One validity run of a property in `temporal` mode: a value (literal/location)
 * or an entity `ref` (or an `agent`, for special properties), with the period
 * it held (`periodFrom`/`periodTo`; `periodTo: null` = current) and the sighting
 * anchors that bound it as error bars. Not conformant JSON-LD — this is the
 * store's own temporal wire envelope.
 */
export interface SchemaFact {
  /** Literal or location value; absent for entity-ref and special facts. */
  value?: unknown;
  /** The referenced entity (shallow `{@type,name}` ref, or expanded). */
  ref?: SchemaEntity;
  /** The acting agent for a special property (a shallow ref). */
  agent?: SchemaEntity;
  source: string;
  periodFrom: string | null;
  periodTo: string | null;
  firstObserved: string | null;
  lastConfirmed: string | null;
}

/**
 * A merged entity with its full history, returned by `serializeSchema` when
 * `temporal` is set: identity (`@id`/`@type`/`name`), the optional sourced-entity
 * merge cluster (`@sources`), and every property's validity runs.
 */
export interface TemporalEntity {
  '@id'?: string;
  '@type': string[];
  name?: string;
  /** The entity's canonical URL from its keyset — a web page/bookmark link, or
   *  an image's CDN URL — when present. */
  url?: string;
  /** A representative image, resolved like an action's (see `imageRefs`). */
  image?: ActionImageRef;
  '@sources'?: SourceRecord[];
  properties: Record<string, SchemaFact[]>;
}

/**
 * One open (current) property run, carrying the columns `electWinner`/
 * `compareCandidates` rank on so the single-valued pick uses the fold's
 * comparator rather than a content-sort take-first — one election on read and at
 * fold time. `CurrentRow` is a `CandidateRow` scoped to an entity.
 */
interface CurrentRow extends CandidateRow {
  entityId: number;
}

/** A single validity run, with the temporal columns `temporal` mode renders. */
interface TemporalRow {
  entityId: number;
  predicate: string;
  literalBody: string | null;
  locationPayload: string | null;
  objectEntityId: number | null;
  agentEntityId: number | null;
  hasAgent: number;
  source: string;
  periodFrom: number | null;
  periodTo: number | null;
  firstObservedAt: number | null;
  lastConfirmedAt: number | null;
}

const SPECIAL_PREDICATES = getSpecialPropertyDefs().map(d => d.predicate);

const iso = (ms: number | null) => (ms === null ? null : formatInstant(ms));

export interface SchemaOptions {
  /** Restrict the top-level results to these entity ids, preserving order. */
  entityIds?: number[];
  /**
   * Expand entity-valued references into full nested entities up to this many
   * hops (0 = shallow {@type,name} refs, the default).
   */
  depth?: number;
  /**
   * Expand only these dot-paths (e.g. "author.birthPlace"), in addition to any
   * `depth`. A path expands every hop along it.
   */
  expand?: string[];
  /**
   * Include content-based `@id`s. Off by default: a merged entity has no single
   * natural id and the content id shifts as it accretes sources, so results read
   * cleaner without it. Turn on when you need to reference entities.
   */
  ids?: boolean;
  /**
   * Render each property as its full set of validity runs (`SchemaFact[]` under
   * `properties`) instead of current scalars — values over time, with provenance
   * and the sighting anchors that bound them. Special properties (e.g.
   * `encountered`, `liked`) are included. Nested `ref`s still render current-value
   * (history is for the focused entity, not its neighbors). Forces `ids` on.
   */
  temporal?: boolean;
  /**
   * Attach the sourced-entity merge cluster as `@sources` (which per-source
   * records folded into the entity). Only meaningful with `temporal`.
   */
  sources?: boolean;
}

/**
 * Render entities as Chronicle JSON-LD — the schema the plugins emit — showing
 * each predicate's CURRENT value(s) (open runs; metrics as their latest
 * reading). Single-valued predicates render as scalars, multi-valued as
 * arrays. `@type` is always an array (an entity's type is the union of its
 * sourced entities' types). Entity-valued predicates render as shallow
 * `{@type,name}` references, or, where `depth`/`expand` selects them, as fully
 * nested entities (a traversed subgraph). Cycles along a path are broken by
 * falling back to a shallow ref.
 *
 * With `temporal`, each entity instead renders as a `TemporalEntity`: its
 * properties become validity runs over time (`SchemaFact[]`), optionally with
 * the sourced-entity merge cluster (`@sources`).
 */
export function serializeSchema(
  db: Db,
  options: SchemaOptions & { temporal: true }
): TemporalEntity[];
export function serializeSchema(db: Db, options?: SchemaOptions): SchemaEntity[];
export function serializeSchema(
  db: Db,
  options: SchemaOptions = {}
): SchemaEntity[] | TemporalEntity[] {
  const depth = options.depth ?? 0;
  const expand = options.expand ?? [];
  const temporal = options.temporal ?? false;
  // Temporal facts carry entity `ref`s/`agent`s that need stable @ids to link.
  const withIds = (options.ids ?? false) || temporal;

  // current facts (open runs) — referenced entities need theirs too when
  // hydrating. With entityIds, prefetch only the reachable neighborhood
  // (expansion hops plus one ref layer for shallow {@type,name} references)
  // instead of every fact in the store.
  const scope = boundedScope(db, options.entityIds, depth, expand);
  const factsByEntity = new Map<number, Map<string, CurrentRow[]>>();
  const nameOf = new Map<number, string>();
  for (const r of fetchCurrentFacts(db, scope)) {
    let preds = factsByEntity.get(r.entityId);
    if (!preds) {
      preds = new Map();
      factsByEntity.set(r.entityId, preds);
    }
    const list = preds.get(r.predicate) ?? [];
    list.push(r);
    preds.set(r.predicate, list);
    if (r.predicate === 'name' && r.literalBody !== null && !nameOf.has(r.entityId)) {
      nameOf.set(r.entityId, JSON.parse(r.literalBody) as string);
    }
  }

  // Metrics: the current value of a metric predicate is its latest
  // reading (deterministic tiebreak: observed time, then value).
  const metricsByEntity = new Map<number, Map<string, MetricRow>>();
  for (const m of fetchLatestMetrics(db, scope)) {
    let preds = metricsByEntity.get(m.entityId);
    if (!preds) {
      preds = new Map();
      metricsByEntity.set(m.entityId, preds);
    }
    preds.set(m.predicate, m);
  }

  // Lifecycle dates rendered from occurrences. One occurrence per
  // (object, type), so one date per predicate; formatted at the range precision.
  const datesByEntity = new Map<number, Map<string, string>>();
  for (const r of fetchLifecycleDates(db, scope)) {
    const predicate = getOccurrenceDatePredicate(r.type);
    if (predicate === undefined || r.timeEarliest === null) continue;
    let dates = datesByEntity.get(r.objectEntityId);
    if (!dates) {
      dates = new Map();
      datesByEntity.set(r.objectEntityId, dates);
    }
    dates.set(predicate, formatDateRange(r.timeEarliest, r.timeLatest ?? r.timeEarliest));
  }

  const typesByEntity = entityTypesFor(db, scope);
  const iris = withIds ? entityContentIris(db, scope) : undefined;

  // Many entities carry their canonical URL only in the keyset (a web page or
  // bookmark keyed by `{url}`, an image by its CDN link), never as a property;
  // surface it as `url` so the UI can link out or render the image.
  const urlOf = entityUrls(db, scope ?? [...typesByEntity.keys()]);

  // Handle-carrying entities (tags, accounts) have no `name`; fall back to
  // their sourced handle so refs to them render a label instead of anonymous.
  const unlabeled = (scope ?? [...typesByEntity.keys()]).filter(id => !nameOf.has(id));
  for (const [id, handle] of sourcedHandles(db, unlabeled)) {
    if (!nameOf.has(id)) nameOf.set(id, handle);
  }

  const withId = (entityId: number, out: SchemaEntity): SchemaEntity => {
    if (iris) out['@id'] = iris.get(entityId) ?? `(unresolved:${entityId})`;
    return out;
  };

  const typesOf = (entityId: number) => [...(typesByEntity.get(entityId) ?? [])].sort();

  const shallowRef = (entityId: number): SchemaEntity => {
    const out: SchemaEntity = { '@type': typesOf(entityId) };
    const name = nameOf.get(entityId);
    if (name !== undefined) out.name = name;
    const url = urlOf.get(entityId);
    if (url !== undefined) out.url = url;
    return withId(entityId, out);
  };

  const shouldExpand = (path: string[]): boolean => {
    if (path.length <= depth) return true;
    const dotted = path.join('.');
    return expand.some(e => e === dotted || e.startsWith(`${dotted}.`));
  };

  const buildEntity = (entityId: number, path: string[], visited: Set<number>): SchemaEntity => {
    const entity: SchemaEntity = withId(entityId, { '@type': typesOf(entityId) });
    const preds = factsByEntity.get(entityId);
    if (preds) {
      for (const [predicate, facts] of preds) {
        // A dedupe key and the rendered value for one open run, hydrating an
        // entity-valued run to a nested/shallow ref.
        const renderFact = (f: CandidateRow): { key: string; out: unknown } => {
          if (f.objectEntityId === null) {
            if (f.locPayload !== null) {
              return { key: f.locPayload, out: JSON.parse(f.locPayload) as unknown };
            }
            return {
              key: f.literalBody ?? 'null',
              out: f.literalBody === null ? null : JSON.parse(f.literalBody),
            };
          }
          const childPath = [...path, predicate];
          const expandChild = shouldExpand(childPath) && !visited.has(f.objectEntityId);
          return {
            key: `@${f.objectEntityId}`,
            out: expandChild
              ? buildEntity(f.objectEntityId, childPath, new Set(visited).add(f.objectEntityId))
              : shallowRef(f.objectEntityId),
          };
        };
        if (getPredicateAnnotation(predicate)?.cardinality === 'many') {
          entity[predicate] = dedupeSorted(facts.map(fact => renderFact(fact)));
        } else {
          // Single-valued: the fold's comparator elects the current value, not a
          // content-sort take-first, so the pick matches `resolveStoredField`.
          const winner = electWinner(facts);
          if (winner !== undefined) entity[predicate] = renderFact(winner).out;
        }
      }
    }
    const metricPreds = metricsByEntity.get(entityId);
    if (metricPreds) {
      for (const [predicate, m] of metricPreds) entity[predicate] = m.value;
    }
    const dates = datesByEntity.get(entityId);
    if (dates) {
      for (const [predicate, value] of dates) entity[predicate] = value;
    }
    if (entity.url === undefined) {
      const url = urlOf.get(entityId);
      if (url !== undefined) entity.url = url;
    }
    const image = images.get(entityId);
    if (image !== undefined) entity.image = image;
    return entity;
  };

  const ids =
    options.entityIds ??
    [...new Set([...factsByEntity.keys(), ...metricsByEntity.keys()])].sort((a, b) => a - b);

  // A representative image for the ROOTS only — the same resolution the action
  // serializer runs, so a page shows the same picture in a card as on its
  // timeline row. Roots only because the last resort walks the reverse
  // `snapshotOf` edge, which is a query per batch and pointless for a nested
  // ref rendered as a name.
  const images = resolveImageRefs(db, ids);

  if (!temporal) return ids.map(id => buildEntity(id, [], new Set([id])));

  // Temporal mode: the roots render their full run history; their refs still
  // hydrate as current-value via buildEntity, so only the roots need runs.
  const runsByEntity = new Map<number, Map<string, TemporalRow[]>>();
  for (const r of fetchTemporalFacts(db, ids)) {
    let preds = runsByEntity.get(r.entityId);
    if (!preds) {
      preds = new Map();
      runsByEntity.set(r.entityId, preds);
    }
    const list = preds.get(r.predicate) ?? [];
    list.push(r);
    preds.set(r.predicate, list);
  }
  const clusters = options.sources ? sourceClusters(db, ids) : undefined;

  // Special-property facts reference agent entities outside the current-fact
  // scope; resolve their iri/type/name so shallow refs aren't `(unresolved:n)`.
  const referenced = new Set<number>();
  for (const preds of runsByEntity.values()) {
    for (const rows of preds.values()) {
      for (const r of rows) {
        if (r.agentEntityId !== null) referenced.add(r.agentEntityId);
        if (r.objectEntityId !== null) referenced.add(r.objectEntityId);
      }
    }
  }
  const missing = [...referenced].filter(id => !typesByEntity.has(id));
  if (missing.length > 0) {
    if (iris) for (const [id, iri] of entityContentIris(db, missing)) iris.set(id, iri);
    for (const [id, types] of entityTypesFor(db, missing)) typesByEntity.set(id, types);
    for (const chunk of chunked(missing)) {
      for (const r of db.all<{ id: number; name: string | null }>(sql`
        SELECT id, cached_name AS name FROM entities
        WHERE id IN (${sql.join(
          chunk.map(id => sql`${id}`),
          sql`, `
        )})
      `)) {
        if (r.name !== null && !nameOf.has(r.id)) nameOf.set(r.id, r.name);
      }
    }
  }

  const factRef = (entityId: number, predicate: string): SchemaEntity =>
    shouldExpand([predicate])
      ? buildEntity(entityId, [predicate], new Set([entityId]))
      : shallowRef(entityId);

  const buildFact = (r: TemporalRow): SchemaFact => {
    const fact: SchemaFact = {
      source: r.source,
      periodFrom: iso(r.periodFrom),
      periodTo: iso(r.periodTo),
      firstObserved: iso(r.firstObservedAt),
      lastConfirmed: iso(r.lastConfirmedAt),
    };
    if (r.hasAgent === 1) {
      if (r.agentEntityId !== null) fact.agent = factRef(r.agentEntityId, r.predicate);
    } else if (r.objectEntityId !== null) {
      fact.ref = factRef(r.objectEntityId, r.predicate);
    } else if (r.locationPayload === null) {
      fact.value = r.literalBody === null ? null : (JSON.parse(r.literalBody) as unknown);
    } else {
      fact.value = JSON.parse(r.locationPayload) as unknown;
    }
    return fact;
  };

  const buildTemporalEntity = (entityId: number): TemporalEntity => {
    const out: TemporalEntity = { '@type': typesOf(entityId), properties: {} };
    if (iris) out['@id'] = iris.get(entityId) ?? `(unresolved:${entityId})`;
    const name = nameOf.get(entityId);
    if (name !== undefined) out.name = name;
    const url = urlOf.get(entityId);
    if (url !== undefined) out.url = url;
    const image = images.get(entityId);
    if (image !== undefined) out.image = image;
    if (clusters)
      out['@sources'] = (clusters.get(entityId) ?? []).map(({ id: _id, ...rec }) => rec);
    const preds = runsByEntity.get(entityId);
    if (preds) {
      for (const [predicate, rows] of preds)
        out.properties[predicate] = rows.map(r => buildFact(r));
    }
    // Metrics are a value stream; show only the latest reading as one fact.
    const metricPreds = metricsByEntity.get(entityId);
    if (metricPreds) {
      for (const [predicate, m] of metricPreds) {
        out.properties[predicate] = [
          {
            value: m.value,
            source: m.source,
            periodFrom: null,
            periodTo: null,
            firstObserved: iso(m.observedAt),
            lastConfirmed: iso(m.observedAt),
          },
        ];
      }
    }
    return out;
  };

  return ids.map(id => buildTemporalEntity(id));
}

/**
 * Every validity run (open and closed) for the given root entities, with the
 * temporal columns `temporal` mode renders. Unlike `fetchCurrentFacts` this
 * includes special-property runs (the agent×object relations) and closed runs.
 */
function fetchTemporalFacts(db: Db, rootIds: number[]): TemporalRow[] {
  return chunked([...new Set(rootIds)]).flatMap(chunk =>
    db.all<TemporalRow>(sql`
      SELECT
        p.cached_entity_id                AS entityId,
        p.predicate                AS predicate,
        v.body                     AS literalBody,
        lv.payload                 AS locationPayload,
        p.cached_object_entity_id         AS objectEntityId,
        p.cached_agent_entity_id          AS agentEntityId,
        CASE WHEN p.agent_sourced_id IS NULL THEN 0 ELSE 1 END AS hasAgent,
        se.source                  AS source,
        p.cached_period_from              AS periodFrom,
        p.cached_period_to                AS periodTo,
        p.first_observed_valid_at  AS firstObservedAt,
        p.last_confirmed_valid_at  AS lastConfirmedAt
      FROM properties p
      JOIN sourced_entities se ON se.id = p.sourced_entity_id
      LEFT JOIN vals v ON v.id = p.value_id
      LEFT JOIN location_values lv ON lv.id = p.value_location_id
      WHERE p.cached_entity_id IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`, `
      )})
      ORDER BY p.predicate, p.cached_period_from
    `)
  );
}

/**
 * The entity ids a render starting from `roots` can touch: the roots, every
 * entity reachable within the expansion budget (depth or an expand path), and
 * one further ref layer (rendered as shallow refs, which still need their
 * types and current name). Undefined roots mean the whole store.
 */
function boundedScope(
  db: Db,
  roots: number[] | undefined,
  depth: number,
  expand: string[]
): number[] | undefined {
  if (roots === undefined) return undefined;
  const maxHops = Math.max(depth, ...expand.map(p => p.split('.').length), 0) + 1;
  const scope = new Set<number>(roots);
  let frontier = [...new Set(roots)];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next = new Set<number>();
    for (const chunk of chunked(frontier)) {
      for (const { ref } of db.all<{ ref: number }>(sql`
        SELECT DISTINCT p.cached_object_entity_id AS ref FROM properties p
        WHERE p.cached_period_to IS NULL AND p.cached_object_entity_id IS NOT NULL
          AND p.agent_sourced_id IS NULL
          AND p.cached_entity_id IN (${sql.join(
            chunk.map(id => sql`${id}`),
            sql`, `
          )})
      `)) {
        if (!scope.has(ref)) next.add(ref);
      }
    }
    frontier = [...next];
    for (const id of frontier) scope.add(id);
  }
  return [...scope];
}

function fetchCurrentFacts(db: Db, scope: number[] | undefined): CurrentRow[] {
  const specialFilter = sql.join(
    SPECIAL_PREDICATES.map(p => sql`${p}`),
    sql`, `
  );
  const select = (where: ReturnType<typeof sql>) =>
    db.all<CurrentRow>(sql`
      SELECT
        p.cached_entity_id            AS entityId,
        p.predicate                   AS predicate,
        p.value_id                    AS valueId,
        p.value_sourced_id            AS valueSourcedId,
        p.value_location_id           AS valueLocationId,
        v.body                        AS literalBody,
        v.key                         AS literalKey,
        vse.key                       AS refKey,
        lv.key                        AS locKey,
        lv.payload                    AS locPayload,
        p.cached_object_entity_id     AS objectEntityId,
        se.key                        AS sourcedKey,
        se.source                     AS source,
        CASE WHEN EXISTS (
          SELECT 1 FROM properties c
           WHERE c.predicate = 'canonicalVersion'
             AND c.value_sourced_id = p.sourced_entity_id
             AND c.cached_period_to IS NULL
        ) THEN 1 ELSE 0 END           AS canonical,
        p.cached_period_to            AS periodTo,
        p.last_confirmed_valid_at     AS lastConfirmedValidAt,
        p.last_confirmed_observed_at  AS lastConfirmedObservedAt,
        p.grade                       AS grade
      FROM properties p
      JOIN sourced_entities se ON se.id = p.sourced_entity_id
      LEFT JOIN vals v ON v.id = p.value_id
      LEFT JOIN sourced_entities vse ON vse.id = p.value_sourced_id
      LEFT JOIN location_values lv ON lv.id = p.value_location_id
      WHERE p.cached_period_to IS NULL
        AND p.agent_sourced_id IS NULL
        AND p.predicate NOT IN (${specialFilter})
        ${where}
    `);
  if (scope === undefined) return select(sql``);
  return chunked(scope).flatMap(chunk =>
    select(
      sql`AND p.cached_entity_id IN (${sql.join(
        chunk.map(id => sql`${id}`),
        sql`, `
      )})`
    )
  );
}

interface MetricRow {
  entityId: number;
  predicate: string;
  value: number;
  validAt: number;
  observedAt: number;
  source: string;
}

interface LifecycleDateRow {
  objectEntityId: number;
  type: string;
  timeEarliest: number | null;
  timeLatest: number | null;
}

// An entity's lifecycle date is the time of its occurrence: a Book's
// `datePublished` is its PublishAction's time. Rendered back to the scalar the
// source wrote — the date never lived as a property row.
function fetchLifecycleDates(db: Db, scope: number[] | undefined): LifecycleDateRow[] {
  const types = occurrenceDateTypes();
  if (types.length === 0) return [];
  const typeList = sql.join(
    types.map(t => sql`${t}`),
    sql`, `
  );
  const select = (extra: ReturnType<typeof sql>) =>
    db.all<LifecycleDateRow>(sql`
      SELECT a.cached_object_entity_id AS objectEntityId, a.type AS type,
             a.time_earliest AS timeEarliest, a.time_latest AS timeLatest
      FROM actions a
      WHERE a.cached_object_entity_id IS NOT NULL AND a.time_earliest IS NOT NULL
        AND a.type IN (${typeList}) ${extra}
    `);
  return scope === undefined
    ? select(sql``)
    : chunked(scope).flatMap(chunk =>
        select(
          sql`AND a.cached_object_entity_id IN (${sql.join(
            chunk.map(id => sql`${id}`),
            sql`, `
          )})`
        )
      );
}

function fetchLatestMetrics(db: Db, scope: number[] | undefined): MetricRow[] {
  const select = (where: ReturnType<typeof sql>) =>
    db.all<MetricRow>(sql`
      SELECT m.cached_entity_id AS entityId, m.predicate AS predicate, m.value AS value,
             m.valid_at AS validAt, m.observed_at AS observedAt, se.source AS source
      FROM metrics m
      JOIN sourced_entities se ON se.id = m.sourced_entity_id
      ${where}
    `);
  const rows =
    scope === undefined
      ? select(sql``)
      : chunked(scope).flatMap(chunk =>
          select(
            sql`WHERE m.cached_entity_id IN (${sql.join(
              chunk.map(id => sql`${id}`),
              sql`, `
            )})`
          )
        );
  const latest = new Map<string, MetricRow>();
  for (const r of rows) {
    const key = `${r.entityId}|${r.predicate}`;
    const cur = latest.get(key);
    if (
      !cur ||
      r.validAt > cur.validAt ||
      (r.validAt === cur.validAt &&
        (r.observedAt > cur.observedAt || (r.observedAt === cur.observedAt && r.value > cur.value)))
    ) {
      latest.set(key, r);
    }
  }
  return [...latest.values()];
}

function dedupeSorted(items: Array<{ key: string; out: unknown }>): unknown[] {
  const seen = new Set<string>();
  return items
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .map(i => i.out);
}
