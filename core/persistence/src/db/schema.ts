import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { jsonb } from './jsonb.js';

// ---------------------------------------------------------------------------
// Layer 1 — the log (the only source of truth)
// ---------------------------------------------------------------------------

export const assertions = sqliteTable(
  'assertions',
  {
    // rowid; local "what's new since" ordering only — never crosses the wire.
    id: integer('id').primaryKey({ autoIncrement: true }),
    cid: text('cid').notNull().unique(),
    // 'assert' | 'restated' | 'confirm'; a body-level @kind marker inside the
    // hashed bytes, derived from the body like asserted_at/target_key.
    kind: text('kind').notNull(),
    // Hash of the body minus its root @assertedAt — an assert and all its
    // confirms share it, which is how "same claim, new sighting" is recognized.
    claimCid: text('claim_cid').notNull(),
    // Keyset hash of the action this assertion projects into. NULL for a confirm,
    // whose body carries no action (resolved through claim_cid at fold time).
    targetKey: text('target_key'),
    // No `source` column: it lives in the hashed body and is read back from
    // `assertion_payloads.body` by the few source-scoped readers (see
    // `assertionSource.ts`). The lifted columns are the fold's join keys only.
    assertedAt: integer('asserted_at').notNull(), // source assertion time; part of the assertion content (in the CID)
    ingestedAt: integer('ingested_at').notNull(), // transaction time; lives only on the log layer, never in derived state
  },
  t => [
    index('assertions_target').on(t.targetKey),
    index('assertions_claim').on(t.claimCid, t.kind),
  ]
);

export const assertionPayloads = sqliteTable('assertion_payloads', {
  cid: text('cid')
    .primaryKey()
    .references(() => assertions.cid),
  // canonical bytes: the exact text that was hashed into the CID.
  body: text('body').notNull(),
});

// Binary content metadata; bytes live in the blob store keyed by cid (CIDv1,
// raw codec). Rows are minted at ingest when `contentData` is rewritten into
// `attachmentCid`; the earliest observing assertion wins first_observed_assertion_cid.
export const attachments = sqliteTable('attachments', {
  cid: text('cid').primaryKey(),
  sizeBytes: integer('size_bytes').notNull(),
  mimeType: text('mime_type'),
  firstObservedAssertionCid: text('first_observed_assertion_cid')
    .notNull()
    .references(() => assertions.cid),
  ingestedAt: integer('ingested_at').notNull(),
});

/**
 * Pairing + identity of this graph file: `archive_id` (minted on first open,
 * stamped into the ops sidecar so a stray sidecar can never be attached to the
 * wrong archive). Never hashed, never replicated, not derived.
 */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// Dictionaries — content-addressed interning (hash → integer id)
// ---------------------------------------------------------------------------

/**
 * Literal values, stored once; observations reference them by id. Predicates
 * are NOT interned — they are short, low-cardinality strings carried inline.
 */
export const vals = sqliteTable('vals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(), // hash of the canonical JSON body
  body: text('body').notNull(), // canonical JSON of the literal
});

// ---------------------------------------------------------------------------
// Entities — the cluster record. Just identity (id) plus the one denormalized
// value we must keep materialized; everything else is derived from the chains
// on read. Cache columns carry a `cached_` prefix to mark them as disposable.
// ---------------------------------------------------------------------------

export const entities = sqliteTable(
  'entities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }), // local surrogate; never crosses the wire
    // Elected display name. The lone materialized cache on the cluster: FTS,
    // name-matching queries, and reference rendering all need it as an indexed
    // column, so it can't be derived on read like the rest. Column is
    // `cached_name`; the drizzle field and serialized output stay `name`.
    name: text('cached_name'),
  },
  t => [index('entities_name').on(t.name)]
);

export const sourcedEntities = sqliteTable(
  'sourced_entities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull().unique(), // hash of the primary @key keyset
    // the ONLY place harmonization is recorded; merges rewrite it before the
    // loser entity row is deleted (the FK enforces that order).
    entityId: integer('entity_id')
      .notNull()
      .references(() => entities.id),
    // The namespace this record's identity belongs to. Usually a product
    // (`goodreads`, `chrome`); for a portable, standard identifier it is the
    // protocol namespace instead — `email`, `phone`, `isbn`, and `url` for a
    // url-identified entity, which is owned by no product however many witnessed
    // it. Read off the keyset, so a row shared by key has a source that is a
    // function of that key alone.
    source: text('source').notNull(),
    // Keyset preimage; NULL when identity arrived pre-derived as `@id` (the hash
    // is authoritative, the preimage withheld). Display fallbacks that read it
    // degrade gracefully to anonymous.
    keyset: jsonb<Record<string, unknown>>('keyset'),
    // The source's own id for this record, whether or not it is part of the
    // keyset. NULL when the record carried none.
    sourceId: text('source_id'),
    // The record's current handle (username, slug, path) and url, whether or not
    // they are part of the keyset — so they survive the keyset preimage being
    // absent, which it already is for an `@id`-only identity. When the field IS
    // in the keyset it cannot change, so the birth record's value stands; when it
    // is not, the value is a Run like any other and this column is that Run's
    // elected current value. NULL when no sighting carried one.
    handle: text('handle'),
    url: text('url'),
    // A source record has exactly one @type (it's part of the keyset). The
    // multi-type union lives at the entity level (`entity_types`).
    type: text('type').notNull(),
  },
  t => [index('sourced_entities_entity').on(t.entityId)]
);

// union over sourced types; indexed substitute for arrays.
export const entityTypes = sqliteTable(
  'entity_types',
  {
    entityId: integer('entity_id')
      .notNull()
      .references(() => entities.id),
    type: text('type').notNull(),
  },
  t => [primaryKey({ columns: [t.type, t.entityId] })]
);

/**
 * Content-keyed geographic values — a dictionary like `vals`, with a derived
 * enrichment layer. `payload` is the verbatim raw location a plugin emitted;
 * `key` is the hash of its canonical form, so identical raw inputs dedupe.
 * Coordinates are GENERATED from the blob (they cannot drift from it). The
 * admin-area FKs (`country_id`/`region_id`/`locality_id`), normalized
 * `postal_code`, and provenance columns are filled later by the geocoder — a
 * derived function of (payload, gazetteer), NULL until then. Identity is the raw
 * hash alone, so enrichment never changes a row's key or breaks references to it.
 */
export const locationValues = sqliteTable(
  'location_values',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull().unique(), // hash of canonical(payload)
    payload: text('payload').notNull(), // verbatim raw location JSON (immutable; the only truth here)
    // pass-through: generated from the blob, cannot drift
    latitude: real('latitude').generatedAlwaysAs(sql`json_extract(payload, '$.latitude')`, {
      mode: 'stored',
    }),
    longitude: real('longitude').generatedAlwaysAs(sql`json_extract(payload, '$.longitude')`, {
      mode: 'stored',
    }),
    // The named place this location IS, when one exists (a Venue, a City). Set
    // when a sourced entity declares this location as its own; NULL for a bare
    // coordinate. A merge-rewritten cache, like the action role
    // `cached_*_entity_id`s. Drizzle field stays `entityId`; column is prefixed.
    entityId: integer('cached_entity_id').references(() => entities.id),
    // enriched: geocoder-filled, mutable, derived (NULL until geocoded)
    countryId: integer('country_id').references(() => entities.id),
    regionId: integer('region_id').references(() => entities.id),
    localityId: integer('locality_id').references(() => entities.id),
    postalCode: text('postal_code'),
    // provenance of the enrichment
    geocodedBy: text('geocoded_by'),
    geocodedAt: integer('geocoded_at'),
    gazetteerVer: text('gazetteer_ver'),
    confidence: real('confidence'),
  },
  t => [
    index('location_values_country').on(t.countryId),
    index('location_values_region').on(t.regionId),
    index('location_values_locality').on(t.localityId),
    // A place's location values, to find the runs that reach it through one.
    index('location_values_entity').on(t.entityId),
  ]
);

// ---------------------------------------------------------------------------
// The observations table — the log shredded into chains (pure function of the assertion SET)
// ---------------------------------------------------------------------------

/**
 * One row per (assertion, claim). Identity is the placement-major unique index
 * (assertion_id included), so the observations table is a pure function of the assertion
 * set and INSERT OR IGNORE is the entire merge protocol; a chain recompute is a
 * sequential index-range read.
 *
 * The value is split by range so each reference carries a real foreign key:
 * `value_id` → vals (literals), `value_sourced_id` → sourced_entities (the
 * keyset hash IS the value identity). Exactly one is set on a sighting; both
 * NULL is the absence sentinel / snapshot marker.
 */
export const observations = sqliteTable(
  'observations',
  {
    subjectId: integer('subject_id')
      .notNull()
      .references(() => sourcedEntities.id), // sourced entity
    predicate: text('predicate').notNull(),
    validAt: integer('valid_at').notNull(), // placement; defaults to observed_at at shred time
    observedAt: integer('observed_at').notNull(), // = the carrying Assertion's asserted_at
    valueId: integer('value_id').references(() => vals.id),
    valueSourcedId: integer('value_sourced_id').references(() => sourcedEntities.id),
    valueLocationId: integer('value_location_id').references(() => locationValues.id),
    actionId: integer('action_id')
      .notNull()
      .references(() => actions.id), // observing activity (anchor target)
    assertionId: integer('assertion_id')
      .notNull()
      .references(() => assertions.id), // assertion provenance
    grade: integer('grade').notNull(), // 0 = observed, 1 = origin (deterministic from assertion content)
  },
  t => [
    uniqueIndex('observations_identity').on(
      t.subjectId,
      t.predicate,
      t.validAt,
      t.observedAt,
      sql`IFNULL(${t.valueId}, 0)`,
      sql`IFNULL(${t.valueSourcedId}, 0)`,
      sql`IFNULL(${t.valueLocationId}, 0)`,
      t.actionId,
      t.assertionId
    ),
    // At most one value column is set; all-NULL is the absence sentinel / marker.
    check(
      'observations_value_xor',
      sql`(${t.valueId} IS NOT NULL) + (${t.valueSourcedId} IS NOT NULL) + (${t.valueLocationId} IS NOT NULL) <= 1`
    ),
  ]
);

// ---------------------------------------------------------------------------
// Actions (fully immutable content; founding payload deterministically elected)
// ---------------------------------------------------------------------------

export const actions = sqliteTable(
  'actions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull().unique(), // @key keyset hash = assertions.target_key
    // The dedupe keyset `key` hashes; NULL when identity arrived pre-derived as
    // `@id` (hash authoritative, preimage withheld).
    keyset: jsonb<Record<string, unknown>>('keyset'),
    type: text('type').notNull(),
    source: text('source').notNull(),
    sourceId: text('source_id'),
    // Founding payload's assertion time (@assertedAt ?? timestamp ?? startTime
    // ?? endTime); timeless payloads are rejected at ingest, so NOT NULL.
    assertedAt: integer('asserted_at').notNull(),
    startTime: integer('start_time'),
    endTime: integer('end_time'),
    // Resolved occurrence range (fuzzy dates): the closed interval the action's
    // semantic time is known to fall in, sized by the coarsest evidence. A
    // precise timestamp collapses both to the same instant; "1949" spans the
    // year. A min/max-wins register across every assertion sharing the key —
    // `time_earliest` = MAX(lowers), `time_latest` = MIN(uppers) — so it narrows
    // as finer evidence arrives, order-independently. An inverted range
    // (earliest > latest) is the surfaced conflict signal. NULL = no occurrence
    // time asserted (only a sighting/assertion time is known).
    timeEarliest: integer('time_earliest'),
    timeLatest: integer('time_latest'),
    // When the action occurred — its timeline placement. The occurrence lower
    // bound if known, else the sighting time. Generated/stored so the timeline's
    // hot-path ordering stays indexed and recomputes when the range narrows.
    occurredAt: integer('occurred_at').generatedAlwaysAs(
      (): ReturnType<typeof sql> => sql`COALESCE(time_earliest, asserted_at)`,
      { mode: 'stored' }
    ),
    // True when the fold materialised this action because a lifecycle/reaction
    // fact had no backing source assertion (e.g. a reading list that only says
    // "finished in 2019"). Keyed by content (type + participants), not a source
    // `@key`. Carries no identity weight — UX filtering and re-election
    // precedence only (a real source action supersedes a synthetic one).
    synthetic: integer('synthetic', { mode: 'boolean' }).notNull().default(false),
    // The assertion whose payload this row projects: smallest (asserted_at, cid)
    // among assertions sharing the target key — deterministic across arrival orders.
    foundingAssertionCid: text('founding_assertion_cid')
      .notNull()
      .references(() => assertions.cid),
    // per role slot, a truth/cache FK pair (first entity wins when a payload
    // carries multiple). The sourced ids are truth (FK-enforced); the entity
    // ids are merge-rewritten caches, so their columns carry the `cached_`
    // prefix (drizzle fields stay `*EntityId`). The full founding payload is not
    // stored here — it is recoverable via founding_assertion_cid → assertion_payloads.body.
    agentSourcedId: integer('agent_sourced_id').references(() => sourcedEntities.id),
    agentEntityId: integer('cached_agent_entity_id').references(() => entities.id),
    objectSourcedId: integer('object_sourced_id').references(() => sourcedEntities.id),
    objectEntityId: integer('cached_object_entity_id').references(() => entities.id),
    // An action's location is a point: a single FK to the location value (a
    // bare coordinate, or a named place's canonical location, which links back
    // up to its entity via location_values.cached_entity_id).
    locationLocationId: integer('location_location_id').references(() => locationValues.id),
    resultSourcedId: integer('result_sourced_id').references(() => sourcedEntities.id),
    resultEntityId: integer('cached_result_entity_id').references(() => entities.id),
    instrumentSourcedId: integer('instrument_sourced_id').references(() => sourcedEntities.id),
    instrumentEntityId: integer('cached_instrument_entity_id').references(() => entities.id),
    targetSourcedId: integer('target_sourced_id').references(() => sourcedEntities.id),
    targetEntityId: integer('cached_target_entity_id').references(() => entities.id),
  },
  t => [
    index('actions_asserted').on(t.assertedAt, t.id),
    index('actions_occurred').on(t.occurredAt, t.id),
    // Occurrence ranges by their upper bound, and the actions with no occurrence
    // time, so a time-window filter reads only the actions near the window.
    index('actions_latest').on(t.timeLatest),
    index('actions_timeless')
      .on(t.timeLatest)
      .where(sql`time_earliest IS NULL`),
    index('actions_type_asserted').on(t.type, t.assertedAt, t.id),
    index('actions_object_entity').on(t.objectEntityId),
    index('actions_agent_entity').on(t.agentEntityId),
    index('actions_result_entity').on(t.resultEntityId),
    index('actions_location').on(t.locationLocationId),
    index('actions_type_object').on(t.type, t.objectEntityId),
    // special-property chain scans: (object sourced, type, agent sourced)
    index('actions_object_sourced_type').on(t.objectSourcedId, t.type),
  ]
);

// ---------------------------------------------------------------------------
// Encounters — derived per-interaction event log
// ---------------------------------------------------------------------------

/**
 * One row per interaction instance — the point-event index behind "every
 * interaction with X over time" and entity recency-sort. Fully derived,
 * append-only, idempotent per `originating_action_id` (delete-by-action then
 * re-emit at shred). Unlike a validity run, an encounter is a point event: it
 * carries the originating action's timestamp and never reconciles, so busy
 * messaging pairs append in O(1) instead of rescanning a hot chain.
 *
 * Each endpoint is a truth/cache pair (as in `actions`/`properties`): the
 * `_sourced_id` is FK-enforced truth (the exact identity encountered — a
 * WhatsApp JID vs the merged phone), the `_entity_id` is the merge-rewritten
 * cache the hot reverse-lookup queries hit, so X resolves across sameAs-merged
 * identities. Post-merge duplicate rows are correct (two real events), never
 * deduped. The encounterer columns are NULL for a self-authored action. `level`
 * grades the contact: 'encounter' (one-directional — consume/like/bookmark/
 * visit, or a phase-2 transitive target) vs 'interaction' (a two-way exchange).
 */
// Participant edges: every entity filler of every role slot —
// including the multi-valued roles (recipient/attendee/with) that have no
// single-FK column on actions. Truth/cache pair like the encounter endpoints.
export const actionRoleEdges = sqliteTable(
  'action_role_edges',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actionId: integer('action_id')
      .notNull()
      .references(() => actions.id),
    role: text('role').notNull(),
    sourcedId: integer('sourced_id')
      .notNull()
      .references(() => sourcedEntities.id),
    entityId: integer('cached_entity_id')
      .notNull()
      .references(() => entities.id),
  },
  t => [
    uniqueIndex('action_role_edges_identity').on(t.actionId, t.role, t.sourcedId),
    index('action_role_edges_action').on(t.actionId, t.role),
    index('action_role_edges_entity').on(t.entityId),
  ]
);

export const encounters = sqliteTable(
  'encounters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    originatingActionId: integer('originating_action_id')
      .notNull()
      .references(() => actions.id),
    cachedTimestamp: integer('cached_timestamp').notNull(),
    encountererSourcedId: integer('encounterer_sourced_id').references(() => sourcedEntities.id),
    encountererEntityId: integer('cached_encounterer_entity_id').references(() => entities.id),
    subjectSourcedId: integer('subject_sourced_id')
      .notNull()
      .references(() => sourcedEntities.id),
    subjectEntityId: integer('cached_subject_entity_id')
      .notNull()
      .references(() => entities.id),
    level: text('level').notNull(),
  },
  t => [
    // recency-sort + pair lookup: MAX(cached_timestamp) GROUP BY subject
    index('encounters_pair').on(t.encountererEntityId, t.subjectEntityId, t.cachedTimestamp),
    // the subject side of the uniform timeline scan (received / group posts)
    index('encounters_subject').on(t.subjectEntityId, t.cachedTimestamp),
    // idempotency: delete-by-action before re-emit
    index('encounters_action').on(t.originatingActionId),
  ]
);

// ---------------------------------------------------------------------------
// Properties — derived validity runs (disposable; rebuilt per chain)
// ---------------------------------------------------------------------------

/**
 * A run = one maximal stretch of one value on a chain. (subject, predicate,
 * value) is immutable; period bounds and anchors are revised as evidence
 * arrives. Each anchor is (valid_at, observed_at, action_id) — an observation
 * reference. `cached_period_from/to` are denormalized copies of anchor
 * placement times so temporal predicates hit indexes; bounds derive FROM
 * anchors (drizzle fields stay `periodFrom`/`periodTo`).
 *
 * Row ids are best-effort stable (positional run matching), never contractual.
 *
 * Special properties (encountered/liked/consuming/completed) live here too,
 * with the agent columns set; their substrate is the actions table. A run
 * always carries a value, so exactly one of value_id / value_sourced_id is set.
 */
export const properties = sqliteTable(
  'properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourcedEntityId: integer('sourced_entity_id')
      .notNull()
      .references(() => sourcedEntities.id),
    entityId: integer('cached_entity_id')
      .notNull()
      .references(() => entities.id), // cache: merge-rewritten, query-only
    predicate: text('predicate').notNull(),
    valueId: integer('value_id').references(() => vals.id),
    valueSourcedId: integer('value_sourced_id').references(() => sourcedEntities.id),
    valueLocationId: integer('value_location_id').references(() => locationValues.id),
    agentSourcedId: integer('agent_sourced_id').references(() => sourcedEntities.id), // special properties only
    agentEntityId: integer('cached_agent_entity_id').references(() => entities.id), // cache
    objectEntityId: integer('cached_object_entity_id').references(() => entities.id), // cache, for entity-valued predicates
    // min-wins anchor: earliest evidence of the run
    firstObservedValidAt: integer('first_observed_valid_at').notNull(),
    firstObservedObservedAt: integer('first_observed_observed_at').notNull(),
    firstObservedActionId: integer('first_observed_action_id')
      .notNull()
      .references(() => actions.id),
    // max-wins anchor: latest evidence (staleness signal)
    lastConfirmedValidAt: integer('last_confirmed_valid_at').notNull(),
    lastConfirmedObservedAt: integer('last_confirmed_observed_at').notNull(),
    lastConfirmedActionId: integer('last_confirmed_action_id')
      .notNull()
      .references(() => actions.id),
    // what closed the run: the competing value's first sighting or an absence/
    // snapshot marker (NULL = open)
    closingValidAt: integer('closing_valid_at'),
    closingObservedAt: integer('closing_observed_at'),
    closingActionId: integer('closing_action_id').references(() => actions.id),
    periodFrom: integer('cached_period_from'), // NULL = unknown start
    periodTo: integer('cached_period_to'), // NULL = open
    // The occurrence that opened this run, when its start is an agentless
    // lifecycle occurrence: a birthPlace/creator edge points back to the
    // BirthAction/CreateAction it was routed from. NULL for ordinary runs. The
    // explicit graph-view link; validity already derives from the anchors.
    originatorActionId: integer('originator_action_id').references(() => actions.id),
    // max grade among the run's evidence (0 observed, 1 origin); election input
    grade: integer('grade').notNull().default(0),
  },
  t => [
    index('properties_chain').on(t.sourcedEntityId, t.predicate),
    index('properties_lookup').on(t.predicate, t.valueId, t.periodTo),
    index('properties_entity').on(t.entityId, t.predicate),
    index('properties_object').on(t.objectEntityId, t.predicate),
    index('properties_agent').on(t.agentEntityId, t.predicate),
    // Reverse lookup for boundary invalidation: when an Action's
    // occurrence register narrows, find the runs it anchors (opener or closer).
    // Two single-column indexes let SQLite OR-union them.
    index('properties_originator').on(t.originatorActionId),
    index('properties_closer').on(t.closingActionId),
    // The few runs whose value is a location value, by that value.
    index('properties_location')
      .on(t.valueLocationId)
      .where(sql`value_location_id IS NOT NULL`),
    // A run always carries exactly one value (literal, entity, or location).
    check(
      'properties_value_xor',
      sql`(${t.valueId} IS NOT NULL) + (${t.valueSourcedId} IS NOT NULL) + (${t.valueLocationId} IS NOT NULL) = 1`
    ),
  ]
);

// ---------------------------------------------------------------------------
// Metrics — numeric streams (observations-exempt; routed by ontology group)
// ---------------------------------------------------------------------------

export const metrics = sqliteTable(
  'metrics',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourcedEntityId: integer('sourced_entity_id')
      .notNull()
      .references(() => sourcedEntities.id),
    entityId: integer('cached_entity_id')
      .notNull()
      .references(() => entities.id), // cache
    predicate: text('predicate').notNull(),
    actionId: integer('action_id')
      .notNull()
      .references(() => actions.id),
    value: real('value').notNull(),
    validAt: integer('valid_at').notNull(),
    observedAt: integer('observed_at').notNull(),
  },
  t => [
    uniqueIndex('metrics_dedupe').on(t.sourcedEntityId, t.predicate, t.actionId, t.value),
    index('metrics_series').on(t.entityId, t.predicate, t.validAt),
  ]
);
