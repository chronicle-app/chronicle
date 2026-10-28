import { and, eq, isNull, sql } from 'drizzle-orm';
import { VALUE_TYPES } from '../annotations/schema.js';
import type { Db } from '../db/open.js';
import {
  actions,
  encounters,
  assertionPayloads,
  assertions,
  locationValues,
  metrics,
  observations,
  sourcedEntities,
} from '../db/schema.js';
import {
  extractEntityIdentities,
  generateKeysetCID,
  isSyntheticAction,
  syntheticActionKeyset,
} from '../cid/cid.js';
import { getIdentityEdgePredicates, getPredicateAnnotation } from '../annotations/ontology.js';
import {
  GRADE_OBSERVED,
  GRADE_ORIGIN,
  encounterEmitFor,
  getLifecycleFacet,
  getOccurrenceEdgeFacets,
  isOriginResultType,
  isPropagatingRelation,
  specialPredicatesFor,
} from '../annotations/actionTypes.js';
import { backfillTransitiveEncounters, emitTransitiveEncounters } from './encounters.js';
import { intersectRanges, parseDateRange, parseInstant, type DateRange } from '../time.js';
import type { AssertionKind } from '../assertionKind.js';
import { resolveEntity } from './resolveEntity.js';
import { upsertSourcedEntity } from './sourcedEntity.js';
import { upsertAction } from './actions.js';
import { internLocationValue, internVal } from './dictionaries.js';
import type { FoldContext } from './context.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Force a full recompute of every ordinary run whose boundary is anchored to
 * `actionId` — its opener (`originator_action_id`) or its close
 * (`closing_action_id`). Called when that Action's occurrence register narrowed,
 * so the run re-derives its `cached_period_*` through the anchor. Marks
 * the chain out-of-order to bypass the fast path, which would only bump recency.
 * Special chains read `occurred_at` (a generated column) live and are re-dirtied
 * by any Assertion sharing the key, so they need no entry here.
 */
/**
 * Refresh an Action's observed anchor to the EARLIEST sighting of any claim it
 * carries — MIN(`asserted_at`) over the asserts that project it (`target_key` =
 * key) and the confirms that re-observe those claims (matched through
 * `claim_cid`, since a confirm stores NULL `target_key`). The ingest gate keeps
 * whichever sighting is ingested FIRST as the full assert and demotes the rest to
 * confirms, so `asserted_at` pinned to the founding assert is arrival-ordered;
 * a re-crawled dateless follow ingested newest-first would otherwise open its
 * "by then" bound at the newest crawl. Taking the MIN over ALL sightings makes
 * the observed axis — and `occurred_at`/`time_latest`, which derive from it —
 * order-independent (a pull aggregate: identical whatever order the sightings
 * shredded, and safe against a confirm shredded before its assert, since the
 * assert path re-runs this once the row exists).
 *
 * `time_latest` follows only for a STATE observation (`time_earliest` NULL, the
 * "by then" upper bound); a dated Action's occurrence bound is real evidence, not
 * a sighting stamp, and is left untouched. Returns whether anything changed, so
 * the caller can invalidate runs anchored to this Action.
 */
function reconcileObservedAnchor(tx: Tx, actionId: number): boolean {
  const row = tx.all<{
    assertedAt: number;
    timeEarliest: number | null;
    timeLatest: number | null;
    minSighting: number | null;
  }>(sql`
    SELECT a.asserted_at AS assertedAt, a.time_earliest AS timeEarliest,
           a.time_latest AS timeLatest,
           (SELECT MIN(s.asserted_at) FROM assertions s
             WHERE s.target_key = a.key
                OR s.claim_cid IN (
                     SELECT a2.claim_cid FROM assertions a2 WHERE a2.target_key = a.key
                   )) AS minSighting
    FROM actions a WHERE a.id = ${actionId}
  `)[0];
  // No stored sightings yet (a synthetic-only anchor) — nothing to lower to.
  if (!row || row.minSighting === null) return false;
  const nextLatest = row.timeEarliest === null ? row.minSighting : row.timeLatest;
  if (row.minSighting === row.assertedAt && nextLatest === row.timeLatest) return false;
  tx.run(sql`
    UPDATE actions SET asserted_at = ${row.minSighting}, time_latest = ${nextLatest}
    WHERE id = ${actionId}
  `);
  // The encounter log caches occurred_at (= COALESCE(time_earliest, asserted_at))
  // at shred time; lowering asserted_at here would otherwise leave those caches
  // stale on the incremental path while a full rebuild re-derives them fresh.
  // Refresh them to the now-updated generated column so both paths agree.
  tx.run(sql`
    UPDATE encounters
       SET cached_timestamp = (SELECT occurred_at FROM actions WHERE id = ${actionId})
     WHERE originating_action_id = ${actionId}
  `);
  return true;
}

function invalidateAnchoredRuns(tx: Tx, ctx: FoldContext, actionId: number): void {
  const anchored = tx.all<{ subjectId: number; predicate: string }>(sql`
    SELECT DISTINCT sourced_entity_id AS subjectId, predicate FROM properties
    WHERE agent_sourced_id IS NULL
      AND (originator_action_id = ${actionId} OR closing_action_id = ${actionId})
  `);
  for (const a of anchored) {
    ctx.dirtyChain(tx, a.subjectId, a.predicate).invalidated = true;
  }
}

// Identity / structural keys that are not observable predicates. Identity-edge
// predicates (ontology `identityEffect` — `sameAs`, `differentFrom`) are folded
// in dynamically: merge edges are consumed by extractEntityIdentities to drive the
// entity union, cut edges are inert for now, and neither is an observation property.
const {
  merge: MERGE_EDGES,
  cut: CUT_EDGES,
  observed: OBSERVED_EDGES,
} = getIdentityEdgePredicates();
// An identity edge is normally structural — it drives the entity union and is
// never a property row. `observed` opts one out: `canonicalVersion` merges like
// `sameAs` AND records a value, because which address a site prefers is
// directional and can change, while the merge itself is grow-only and timeless.
// Each half then lands in the layer built for it, and a changed declaration is a
// Run rather than two contradictory edges no ordering can resolve.
const OBSERVED_EDGE_SET = new Set<string>(OBSERVED_EDGES);
const STRUCTURAL_KEYS = new Set(
  [
    '@type',
    '@key',
    '@id',
    '@asserts',
    '@assertedAt',
    'source',
    'sourceId',
    'handle',
    'url',
    ...MERGE_EDGES,
    ...CUT_EDGES,
  ].filter(k => !OBSERVED_EDGE_SET.has(k))
);

// The auto `{source:'url', url}` keyset is materialized as its own sourced node
// so any record bearing the same url merges through it. It belongs to the `url`
// namespace, not to the record that witnessed it: a URL is a portable, standard
// identifier, the same class as `email`/`phone`/`isbn`, so the browser
// ViewAction or archive link that named it keeps its own `source` on its own row
// while the url identity is shared and product-neutral. A merged entity that also
// has a real native keyset keeps that sourced row alongside this one. The type is
// the bare ontology root — a url locates a thing of unknown kind, and the real
// type arrives via the entity_types union when an importer merges in.
const URL_NODE_TYPE = 'Entity';

// Identifiers that are also ordinary predicates: they name the thing AND are
// facts about it. Which one they are on a given node is decided by that node's
// keyset, not globally.
//
// Keyed: the identity already records the value and it CANNOT change, so an
// observation per sighting would restate the key forever — an hourly crawl of one
// page writing "this url's url is that url", on the highest-frequency entities in
// the store. The column carries the value instead, written once.
//
// Not keyed (a post's permalink, a Slack user's handle beside their id): the value
// can be renamed, so it shreds like anything else and its Run is the history —
// which is the whole point of observing identifiers at all.
const IDENTIFIER_FIELDS = ['handle', 'url'] as const;

function keyedIdentifierFields(keyset: Record<string, unknown> | null | undefined): Set<string> {
  const keyed = new Set<string>();
  // No preimage (an `@id`-only identity) means we cannot read what it keys on, so
  // nothing is treated as keyed. That direction is forced by the export: it
  // references entities by `@id` and emits only their PROPERTIES as fields, so a
  // `url` on an `@id` node is by construction an observed value — assume
  // otherwise and re-importing an export silently drops it (the determinism
  // oracle catches exactly this). The opposite error, a hand-authored
  // `@id` node whose url really is its key, costs a redundant row and nothing else.
  if (!keyset) return keyed;
  for (const field of IDENTIFIER_FIELDS) if (field in keyset) keyed.add(field);
  return keyed;
}

const ACTION_ROLE_KEYS = ['agent', 'object', 'location', 'result', 'instrument', 'target'] as const;

// Multi-valued roles: no single-FK slot on `actions`; every filler
// lands in action_role_edges only.
const MULTI_ROLE_KEYS = ['recipient', 'attendee', 'with'] as const;

interface EntityResult {
  sourcedId: number;
  primaryKey: string;
}

interface PendingObservation {
  subjectId: number;
  predicate: string;
  validAt: number;
  observedAt: number;
  /** interned literal; NULL for entity-ranged values and absence markers */
  valueId: number | null;
  /** referenced sourced entity; NULL for literals and absence markers */
  valueSourcedId: number | null;
  /** interned location value; NULL for literals, entities, and markers */
  valueLocationId: number | null;
  grade: number;
}

interface PendingMetric {
  sourcedEntityId: number;
  predicate: string;
  value: number;
  validAt: number;
  observedAt: number;
}

function isEntityNode(v: unknown): v is Record<string, unknown> {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['@type'] === 'string'
  );
}

// A value object: a node whose `@type` is a value type (a StructuredValue
// descendant, e.g. `Location`). It carries no identity, so it is content-interned
// into the value store rather than resolved as a sourced entity — the payload-
// keyed grain (raw coordinates/address) the geocoder later enriches. Entity-typed
// nodes (`Venue`, `City`, …) carry a `@key` and take the normal entity path.
function isLocationValue(node: Record<string, unknown>): boolean {
  return typeof node['@type'] === 'string' && VALUE_TYPES.has(node['@type']);
}

// The raw geo payload of a location node: its predicates minus structural keys.
function locationPayload(node: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (STRUCTURAL_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// The location value a named place (a Venue, a City) carries as its own point —
// the first value-typed geo node among its predicates (e.g. a Venue's nested
// `location`). Used to give the action a point when its location slot holds a
// place entity rather than a bare value.
function placeLocationValue(node: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const [k, v] of Object.entries(node)) {
    if (STRUCTURAL_KEYS.has(k)) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      if (isEntityNode(item) && isLocationValue(item)) return item;
    }
  }
  return undefined;
}

/**
 * Shred one already-ingested event into the observations table and derived dictionaries:
 * sourced entities, the action row (founding-elected), observation rows, metric
 * readings. Marks every touched chain/entity dirty on the fold context; run
 * recomputation happens once per dirty chain at batch commit.
 */
export function shredAssertion(tx: Tx, ctx: FoldContext, cid: string): void {
  const eventRow = tx
    .select({
      id: assertions.id,
      kind: assertions.kind,
      claimCid: assertions.claimCid,
      assertedAt: assertions.assertedAt,
      body: assertionPayloads.body,
    })
    .from(assertions)
    .innerJoin(assertionPayloads, eq(assertionPayloads.cid, assertions.cid))
    .where(eq(assertions.cid, cid))
    .get();
  if (!eventRow) throw new Error(`No payload for event ${cid}`);
  ctx.trace({ phase: 'shred', step: 'start', cid, kind: eventRow.kind });

  // A `confirm` re-observes a known claim: body = claim CID + a new stamp, with
  // no action and zero observation rows of its own. Its only fold effect is to
  // re-date recency: dirty every chain that has a observation row from an assertion
  // sharing the confirm's claim CID, so `recomputeChain` re-reads the confirm
  // times and extends each affected run's `last_confirmed` (decisions A/B). A
  // dangling confirm (arriving before its claim) finds no rows and sits inert;
  // when the claim's own payload lands and its chains fold, the same
  // `(claim_cid, kind)` join picks the confirm up — convergence under union.
  if (eventRow.kind === 'confirm') {
    const affected = tx.all<{ subjectId: number; predicate: string }>(sql`
      SELECT DISTINCT o.subject_id AS subjectId, o.predicate AS predicate
      FROM observations o
      JOIN assertions a ON a.id = o.assertion_id
      WHERE a.claim_cid = ${eventRow.claimCid}
    `);
    for (const c of affected) ctx.dirtyChain(tx, c.subjectId, c.predicate);
    // Special (action-derived) chains carry no observations, so the join above
    // misses them: reach them through the action the confirmed claim founds
    // (assert `target_key` = action key). Each such action's type implies its
    // special predicates, whose recency the confirm now extends (special.ts).
    const specialActions = tx.all<{
      objectSourcedId: number;
      agentSourcedId: number | null;
      type: string;
    }>(sql`
      SELECT DISTINCT ac.object_sourced_id AS objectSourcedId,
             ac.agent_sourced_id AS agentSourcedId, ac.type AS type
      FROM assertions a
      JOIN actions ac ON ac.key = a.target_key
      WHERE a.claim_cid = ${eventRow.claimCid} AND a.kind = 'assert'
        AND ac.object_sourced_id IS NOT NULL
    `);
    for (const a of specialActions) {
      for (const def of specialPredicatesFor(a.type)) {
        ctx.dirtySpecialChain(a.objectSourcedId, def.predicate, a.agentSourcedId);
      }
    }
    // A re-observation can PREDATE the founding assert — a re-crawl ingested
    // newest-first, or a synced older sighting. Lower every Action this claim
    // anchors to the earliest sighting, so its observed axis and "by then" bound
    // do not depend on which sighting shredded first. Unchanged for the
    // common case (a later monthly re-crawl leaves the MIN alone). A change can
    // move an ordinary run's boundary, so invalidate its anchors; special chains
    // already re-derive here (they read occurred_at live and recency extends).
    const anchoredActions = tx.all<{ id: number }>(sql`
      SELECT DISTINCT ac.id AS id
      FROM assertions a
      JOIN actions ac ON ac.key = a.target_key
      WHERE a.claim_cid = ${eventRow.claimCid}
    `);
    for (const ac of anchoredActions) {
      if (reconcileObservedAnchor(tx, ac.id)) invalidateAnchoredRuns(tx, ctx, ac.id);
    }
    ctx.trace({
      phase: 'shred',
      step: 'confirm-fanout',
      cid,
      chains: affected.length,
      specials: specialActions.length,
      anchors: anchoredActions.length,
    });
    return;
  }

  const body = JSON.parse(eventRow.body) as Record<string, unknown>;
  // The observations table's observed axis IS the event's assertion time (never the
  // action row's founding time — that would freeze re-confirmations). This is
  // the ROOT stamp; nested entity nodes may carry their own scoped `@assertedAt`
  // (a crawl reporting a 2019 like with the channel's description as of the
  // crawl), threaded through processEntity as `inheritedObservedAt` and honored
  // per node. The action row and its occurrence facets stay on the root stamp.
  const rootObservedAt = eventRow.assertedAt;
  const assertionId = eventRow.id;

  const pendingObs: PendingObservation[] = [];
  const pendingMetrics: PendingMetric[] = [];

  // The current entity id behind a sourced entity. Resolved live at flush time
  // (never captured) because an in-event merge later in the shred can delete an
  // entity row and repoint its sourced members onto the survivor: `sourced_id`
  // is the stable handle, `entity_id` is a cache that moves under it.
  const liveEntityId = (sourcedId: number): number =>
    tx
      .select({ entityId: sourcedEntities.entityId })
      .from(sourcedEntities)
      .where(eq(sourcedEntities.id, sourcedId))
      .get()!.entityId;

  const processEntity = (
    entityData: Record<string, unknown>,
    origin: boolean,
    inheritedObservedAt: number
  ): EntityResult => {
    // Scoped sighting axis: this node's own `@assertedAt` if it carries one,
    // else the stamp inherited from its enclosing node (ultimately the root).
    // Every row this node writes — and every child it recurses into — observes
    // at this value, so a mixed-vintage payload places each fact at the moment
    // it was actually witnessed. `no node may carry facts at a time they weren't
    // observed` (spec §Two dimensions).
    const observedAt = parseInstant(entityData['@assertedAt']) ?? inheritedObservedAt;
    const source = String(entityData.source ?? body.source ?? '');
    // Pass the action body as context so @key entries like
    // "action.timestamp" (e.g. shell Command) resolve. An identity's key is its
    // content hash whether it came from a `@key` keyset or a pre-derived `@id`;
    // the preimage (`keyset`) is null in the `@id`-only case.
    const identities = extractEntityIdentities(entityData, source, body);
    const keysetKeys = identities.map(i => i.key);
    const primaryKey = keysetKeys[0];
    const type = String(entityData['@type']);
    // The stored source is the one named in the node's own keyset when it has one
    // — which is what puts a url identity in the `url` namespace rather than
    // attributing the page to the browser that witnessed it. The row is SHARED by
    // key across every record bearing that url, so its source must be a function
    // of the key alone; reading it off the keyset keeps it so, where honoring
    // whichever writer arrived first would make the column order-dependent.
    const storedSource =
      typeof identities[0].keyset?.source === 'string' ? identities[0].keyset.source : source;
    const keyedIdentifiers = keyedIdentifierFields(identities[0].keyset);

    // a sourced entity has one type; the entity-level union is in entity_types
    const { entityId, merged } = resolveEntity(tx, keysetKeys, [type]);
    ctx.touchedEntities.add(entityId);
    ctx.trace({
      phase: 'shred',
      step: 'entity',
      entityId,
      source,
      type,
      key: primaryKey,
      merged: merged !== undefined,
    });
    if (merged) {
      ctx.touchedEntities.add(merged.survivor);
      for (const loser of merged.losers) ctx.touchedEntities.add(loser);
      for (const referrer of merged.referrers) ctx.touchedEntities.add(referrer);
      ctx.trace({
        phase: 'shred',
        step: 'merge',
        survivor: merged.survivor,
        losers: merged.losers,
        referrers: merged.referrers,
      });
    }
    const sourcedId = upsertSourcedEntity(tx, {
      key: primaryKey,
      entityId,
      source: storedSource,
      keyset: identities[0].keyset,
      // the record's own top-level sourceId — persisted whether or not it is
      // part of the keyset (an url-keyed record still names its source id)
      sourceId:
        entityData.sourceId === undefined || entityData.sourceId === null
          ? null
          : String(entityData.sourceId),
      // likewise the top-level handle — a sourceId-keyed record (Slack agent,
      // Arena user) still names its handle
      handle:
        entityData.handle === undefined || entityData.handle === null
          ? null
          : String(entityData.handle),
      // and the url, which a page keyed on it and a post keyed on its own id
      // both carry — the column is what survives the keyset preimage being
      // absent, as it already is for an `@id`-only identity.
      url: typeof entityData.url === 'string' && entityData.url.length > 0 ? entityData.url : null,
      keyedFields: keyedIdentifiers,
      type,
    });

    // Materialize every non-primary keyset as its own sourced node: the auto
    // `{url}` hub and each identity merge-edge alias (e.g. a `sameAs` target's
    // own keyset). resolveEntity has already unioned over these keys; giving each
    // a row is what lets records sharing the key merge through it regardless of
    // arrival order (resolveEntity requires every key it is handed to exist as a
    // sourced_entities row). The alias inherits the keyset's own `@type`/`source`
    // when present (a sameAs target carries them), else the bare url-hub defaults.
    // Skipped when an alias already IS the primary keyset (importer dedupes on it).
    const materializedAliases = new Set<string>([primaryKey]);

    for (let i = 1; i < identities.length; i++) {
      const aliasKey = keysetKeys[i];
      if (materializedAliases.has(aliasKey)) continue;
      materializedAliases.add(aliasKey);
      // An `@id`-only alias (e.g. a pre-derived `sameAs` ref) carries no preimage
      // — its source/type can't be read off a keyset, so it falls back to the
      // materializing record's source and the bare url-hub type.
      const aliasKeyset = identities[i].keyset;
      upsertSourcedEntity(tx, {
        key: aliasKey,
        entityId,
        // The alias belongs to the source named in its own keyset — a sameAs
        // target's real source, or `url` for an auto-minted url identity — and
        // falls back to the materializing record only when the keyset names none
        // (an `@id`-only alias, which carries no preimage at all).
        source: typeof aliasKeyset?.source === 'string' ? aliasKeyset.source : source,
        keyset: aliasKeyset,
        // an alias only knows the id/handle its own keyset carries (a sameAs
        // target's); a bare url hub has neither
        sourceId:
          aliasKeyset?.sourceId === undefined || aliasKeyset.sourceId === null
            ? null
            : String(aliasKeyset.sourceId),
        handle:
          aliasKeyset?.handle === undefined || aliasKeyset.handle === null
            ? null
            : String(aliasKeyset.handle),
        url: typeof aliasKeyset?.url === 'string' ? aliasKeyset.url : null,
        keyedFields: keyedIdentifierFields(aliasKeyset),
        type: typeof aliasKeyset?.['@type'] === 'string' ? aliasKeyset['@type'] : URL_NODE_TYPE,
      });
    }

    // Now that every alias row exists, shred each full merge-edge ref as its own
    // entity: its properties are claims about ITS identity and belong on ITS row.
    // The only difference from an ordinary relation is that no observation links
    // the two — the identity union already did that, so the edge is never a
    // property. Order matters: resolveEntity requires a key's row to exist, so
    // running this before materialization would mint the ref a second entity.
    //
    // Without it the target's fields are silently dropped, defeating the
    // documented convention that an edge carries a title "so an as-yet-unseen
    // target is still named when the edge mints it" — goodreads' ISBN edge and
    // apple-podcasts' catalog edge both pass one and both lost it.
    for (const predicate of MERGE_EDGES) {
      const raw = entityData[predicate];
      if (raw === undefined || raw === null) continue;
      for (const entry of Array.isArray(raw) ? raw : [raw]) {
        // Reserved tokens (`'@me'`) and bare values carry no node to shred; they
        // contributed identity in extractEntityIdentities and nothing else.
        if (isEntityNode(entry)) processEntity(entry, origin, observedAt);
      }
    }

    const grade = origin ? GRADE_ORIGIN : GRADE_OBSERVED;
    // Predicates whose values were present but entirely unparseable (bare
    // literals on an entity range) — excluded from absence minting.
    const unparseable = new Set<string>();
    // Ontology-known predicates that actually shredded a value on this node —
    // the expansion set for an `@asserts: ['*']` wildcard (see below).
    const present = new Set<string>();

    // Lifecycle date facets hoisted onto agentless occurrences: a
    // `datePublished` scalar is the timestamp of this entity's PublishAction, not
    // a property row. Grouped by occurrence type so several facets share one row;
    // materialised after the loop once the entity's identity is fixed.
    const occurrenceTimes = new Map<string, DateRange>();

    for (const [key, raw] of Object.entries(entityData)) {
      // An identifier this node does NOT key on is an ordinary observed value —
      // it can be renamed, and the Run is that history. One it keys on stays
      // structural: immutable by construction, already held by the identity and
      // the column, so an observation would only restate it.
      const identifierIsObservable =
        (IDENTIFIER_FIELDS as readonly string[]).includes(key) && !keyedIdentifiers.has(key);
      if (STRUCTURAL_KEYS.has(key) && !identifierIsObservable) continue;
      // A lifecycle date never becomes a property value; it rides an agentless
      // occurrence's time (rule 1). Only dates do this — place/agent facts stay
      // ordinary edges (the occurrence is at most their originator).
      const facet = getLifecycleFacet(key);
      if (facet) {
        for (const item of Array.isArray(raw) ? raw : [raw]) {
          const range = parseDateRange(item);
          if (!range) continue;
          const prev = occurrenceTimes.get(facet.occurrence);
          occurrenceTimes.set(
            facet.occurrence,
            prev ? (intersectRanges(prev, range) ?? range) : range
          );
        }
        continue;
      }
      const ann = getPredicateAnnotation(key);
      if (!ann) continue; // unknown predicate — not in the authoring contract
      // No authoring surface supplies a valid time distinct from the sighting
      // time yet, so placement mirrors the observed axis.
      const validAt = observedAt;
      const items = Array.isArray(raw) ? raw : [raw];
      let shredded = 0;
      for (const item of items) {
        if (isEntityNode(item)) {
          if (isLocationValue(item)) {
            // Bare Place → content-interned location value (not an entity).
            pendingObs.push({
              subjectId: sourcedId,
              predicate: key,
              validAt,
              observedAt,
              valueId: null,
              valueSourcedId: null,
              valueLocationId: internLocationValue(tx, ctx.caches, locationPayload(item)),
              grade,
            });
            shredded++;
            continue;
          }
          const child = processEntity(item, origin, observedAt);
          pendingObs.push({
            subjectId: sourcedId,
            predicate: key,
            validAt,
            observedAt,
            valueId: null,
            valueSourcedId: child.sourcedId,
            valueLocationId: null,
            grade,
          });
          shredded++;
        } else if (ann.isEntityRange) {
          // Bare literal on an entity-ranged predicate: dropped, never minted
          // into a synthetic handle. Ingest surfaces the diagnostic.
          continue;
        } else if (ann.metric && typeof item === 'number') {
          // Metric streams skip the observations table (interval derivation over
          // distinct-by-nature readings is meaningless and quadratic).
          pendingMetrics.push({
            sourcedEntityId: sourcedId,
            predicate: key,
            value: item,
            validAt,
            observedAt,
          });
          shredded++;
        } else {
          pendingObs.push({
            subjectId: sourcedId,
            predicate: key,
            validAt,
            observedAt,
            valueId: internVal(tx, ctx.caches, item),
            valueSourcedId: null,
            valueLocationId: null,
            grade,
          });
          shredded++;
        }
      }
      if (items.length > 0 && shredded === 0) unparseable.add(key);
      if (shredded > 0) present.add(key);
    }

    // Materialise the hoisted lifecycle dates: one agentless occurrence per type,
    // keyed by content (@type + object) so re-imports and other sources coalesce
    // onto one row and its range narrows. The agent slot is empty by kind — a
    // publication/birth known only by its date has no doer; participants
    // (author, publisher) are ordinary edges on the object.
    for (const [occType, range] of occurrenceTimes) {
      const occKeyset = { '@synthetic': true, '@type': occType, object: primaryKey };
      const occAction = upsertAction(tx, {
        key: generateKeysetCID(occKeyset),
        keyset: occKeyset,
        kind: eventRow.kind as AssertionKind,
        type: occType,
        source,
        sourceId: null,
        assertedAt: observedAt,
        startTime: null,
        endTime: null,
        timeEarliest: range.lower,
        timeLatest: range.upper,
        synthetic: true,
        assertionCid: cid,
        agentSourcedId: null,
        agentEntityId: null,
        objectSourcedId: sourcedId,
        objectEntityId: liveEntityId(sourcedId),
        locationLocationId: null,
        resultSourcedId: null,
        resultEntityId: null,
        instrumentSourcedId: null,
        instrumentEntityId: null,
        targetSourcedId: null,
        targetEntityId: null,
      });
      // Narrowing this occurrence sharpens every edge run it anchors (a hoisted
      // `datePublished` opening a work's timeline); invalidate them.
      if (occAction.rangeChanged) invalidateAnchoredRuns(tx, ctx, occAction.id);
    }

    // @asserts completeness manifest → absence sentinel / snapshot marker
    // (both value columns NULL). Minted only for ontology-known predicates
    // that are not present-but-unparseable; no manifest → no absence
    // inference, ever.
    //
    // A `'*'` wildcard expands to every present cardinality-MANY predicate — the
    // ones competition can't self-close. This is the snapshot completeness
    // default (a state re-read enumerates the whole set), so a value that
    // departed between snapshots (a task moved out of a project) closes. Listing
    // a predicate explicitly also closes it when it goes fully empty — which the
    // wildcard can't, since an absent predicate isn't "present".
    const rawAsserts = entityData['@asserts'];
    if (Array.isArray(rawAsserts)) {
      const names = new Set<string>();
      for (const entry of rawAsserts) {
        if (typeof entry !== 'string') continue;
        if (entry === '*') {
          for (const p of present) {
            if (getPredicateAnnotation(p)?.cardinality === 'many') names.add(p);
          }
        } else {
          names.add(entry);
        }
      }
      for (const name of names) {
        const ann = getPredicateAnnotation(name);
        if (!ann || unparseable.has(name)) continue;
        if (ann.metric) continue; // metrics are observations-exempt
        pendingObs.push({
          subjectId: sourcedId,
          predicate: name,
          validAt: observedAt,
          observedAt,
          valueId: null,
          valueSourcedId: null,
          valueLocationId: null,
          grade,
        });
      }
    }

    return { sourcedId, primaryKey };
  };

  // Role-slot entities of the action (agent / object / location / others).
  const actionType = String(body['@type']);
  const roles: Partial<Record<(typeof ACTION_ROLE_KEYS)[number], EntityResult>> = {};
  // An action's location is a point — a single FK to its location value, not an
  // entity role slot. A named place's canonical location links back up to its
  // entity via location_values.cached_entity_id.
  let locationLocationId: number | null = null;
  // Every entity filler of every role becomes an action_role_edges row —
  // including fillers beyond a single-FK slot's first entity.
  const roleEdges: Array<{ role: string; sourcedId: number }> = [];
  for (const key of ACTION_ROLE_KEYS) {
    const raw = body[key];
    const items = Array.isArray(raw) ? raw : [raw];
    const origin = key === 'result' && isOriginResultType(actionType);
    for (const item of items) {
      if (!isEntityNode(item)) continue;
      if (key === 'location') {
        if (isLocationValue(item)) {
          locationLocationId ??= internLocationValue(tx, ctx.caches, locationPayload(item));
          continue;
        }
        // A named place (entity) in the location slot — the schema allows it
        // (`location` ranges over Place). Resolve the place, then point the
        // action at the place's own location value and up-link that value to the
        // place, so the action's point is kept and the named place is recoverable
        // from it. A place with no embedded location contributes no point (yet);
        // the entity is still resolved, never silently dropped.
        const res = processEntity(item, origin, rootObservedAt);
        const placeLoc = placeLocationValue(item);
        if (placeLoc) {
          const locId = internLocationValue(tx, ctx.caches, locationPayload(placeLoc));
          // Claim the up-link only if unclaimed — never clobber a point that
          // already names a place (the cached_entity_id is a merge-rewritten cache).
          tx.update(locationValues)
            .set({ entityId: liveEntityId(res.sourcedId) })
            .where(and(eq(locationValues.id, locId), isNull(locationValues.entityId)))
            .run();
          locationLocationId ??= locId;
        }
        continue;
      }
      const res = processEntity(item, origin, rootObservedAt);
      roleEdges.push({ role: key, sourcedId: res.sourcedId });
      if (!roles[key]) roles[key] = res;
    }
  }
  for (const key of MULTI_ROLE_KEYS) {
    const raw = body[key];
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (!isEntityNode(item)) continue;
      const res = processEntity(item, false, rootObservedAt);
      roleEdges.push({ role: key, sourcedId: res.sourcedId });
    }
  }

  // The occurrence's own semantic time, parsed at full precision ("1949" stays a
  // year). `@assertedAt` (the crawl/sighting axis) is excluded — it says when a
  // source vouched, not when the thing happened. Reused for the action row below.
  const occurrenceRange = parseDateRange(body.timestamp ?? body.startTime ?? body.endTime) ?? null;

  // Occurrence facet → edge: a real BirthAction/CreateAction states
  // place/agent facts that belong on the OBJECT as edges, not on the agentless
  // occurrence. Route the role slot to a property edge on the object
  // (`location`→`birthPlace`, `agent`→`creator`) and clear the slot, so the
  // occurrence carries only the date and `BirthAction{location}` lands exactly
  // like a bare `birthPlace:` scalar. The edge's validity OPENS at the
  // occurrence's date (its originator) — a birthPlace holds from birth, not from
  // the crawl. `valid_at != observed_at` makes the run's start known.
  if (roles.object) {
    const facetValidAt = occurrenceRange?.lower ?? rootObservedAt;
    for (const ef of getOccurrenceEdgeFacets(actionType)) {
      if (ef.role === 'location' && locationLocationId !== null) {
        pendingObs.push({
          subjectId: roles.object.sourcedId,
          predicate: ef.predicate,
          validAt: facetValidAt,
          observedAt: rootObservedAt,
          valueId: null,
          valueSourcedId: null,
          valueLocationId: locationLocationId,
          grade: GRADE_OBSERVED,
        });
        locationLocationId = null;
      } else if (ef.role === 'agent' && roles.agent) {
        pendingObs.push({
          subjectId: roles.object.sourcedId,
          predicate: ef.predicate,
          validAt: facetValidAt,
          observedAt: rootObservedAt,
          valueId: null,
          valueSourcedId: roles.agent.sourcedId,
          valueLocationId: null,
          grade: GRADE_OBSERVED,
        });
        delete roles.agent;
      }
    }
  }

  // Action row (keyed by its dedupe keyset hash; founding payload elected). A
  // synthetic action is keyed by content (type + participants) — same keyset
  // computed at ingest for `target_key`, so the two stay equal.
  const actionSource = String(body.source ?? '');
  const synthetic = isSyntheticAction(body);
  // A synthetic action is always content-keyed (a real preimage). A real action
  // is keyed by its primary identity — the `@key` keyset (preimage kept) or a
  // pre-derived `@id` (preimage null). Either way the key is the content hash
  // computed identically at ingest for `target_key`, so the two stay equal.
  const { actionKey, actionKeyset } = synthetic
    ? (() => {
        const keyset = syntheticActionKeyset(body, actionSource);
        return { actionKey: generateKeysetCID(keyset), actionKeyset: keyset };
      })()
    : (() => {
        const identity = extractEntityIdentities(body, actionSource)[0];
        return { actionKey: identity.key, actionKeyset: identity.keyset };
      })();
  const { id: actionId, rangeChanged: actionRangeChanged } = upsertAction(tx, {
    key: actionKey,
    keyset: actionKeyset,
    kind: eventRow.kind as AssertionKind,
    type: actionType,
    source: actionSource,
    sourceId: body.sourceId === undefined || body.sourceId === null ? null : String(body.sourceId),
    assertedAt: rootObservedAt,
    startTime: parseInstant(body.startTime) ?? null,
    endTime: parseInstant(body.endTime) ?? null,
    timeEarliest: occurrenceRange?.lower ?? null,
    // No occurrence time → a state observation, not a timeless claim: the act
    // happened BY the sighting, not AT it. Upper-bound the occurrence at this
    // sighting and leave the lower bound open, so `(earliest NULL, latest set)`
    // reads as "by then", distinct from a point `(earliest = latest)` and from
    // "no claim" `(both NULL)`. This seeds the bound from THIS sighting;
    // `reconcileObservedAnchor` below then lowers it (and occurred_at, via
    // asserted_at) to the earliest sighting across every re-crawl.
    timeLatest: occurrenceRange?.upper ?? rootObservedAt,
    synthetic,
    assertionCid: cid,
    agentSourcedId: roles.agent?.sourcedId ?? null,
    agentEntityId: roles.agent ? liveEntityId(roles.agent.sourcedId) : null,
    objectSourcedId: roles.object?.sourcedId ?? null,
    objectEntityId: roles.object ? liveEntityId(roles.object.sourcedId) : null,
    locationLocationId,
    resultSourcedId: roles.result?.sourcedId ?? null,
    resultEntityId: roles.result ? liveEntityId(roles.result.sourcedId) : null,
    instrumentSourcedId: roles.instrument?.sourcedId ?? null,
    instrumentEntityId: roles.instrument ? liveEntityId(roles.instrument.sourcedId) : null,
    targetSourcedId: roles.target?.sourcedId ?? null,
    targetEntityId: roles.target ? liveEntityId(roles.target.sourcedId) : null,
  });
  // Persist the participant edges: idempotent by (action, role,
  // sourced identity); the entity cache is merge-rewritten like every other.
  for (const edge of roleEdges) {
    tx.run(
      sql`INSERT OR IGNORE INTO action_role_edges (action_id, role, sourced_id, cached_entity_id)
          VALUES (${actionId}, ${edge.role}, ${edge.sourcedId}, ${liveEntityId(edge.sourcedId)})`
    );
  }

  // Pull the observed anchor down to the earliest sighting across every re-crawl
  // of this Action's claims — including confirms shredded before this assert.
  // This can lower `time_latest` (the "by then" bound) and, through
  // `asserted_at`, `occurred_at` — so treat a change like an occurrence narrowing.
  const anchorLowered = reconcileObservedAnchor(tx, actionId);
  // A narrowed occurrence sharpens every run this Action anchors (a BirthAction's
  // birthPlace opening, a MoveAction close) — even runs on chains this Assertion
  // does not otherwise touch (a bare finer date restating no edge). Invalidate
  // them so they re-derive through the register in this batch.
  if (actionRangeChanged || anchorLowered) invalidateAnchoredRuns(tx, ctx, actionId);
  ctx.trace({
    phase: 'shred',
    step: 'action',
    actionType,
    key: actionKey,
    agent: roles.agent?.sourcedId ?? null,
    object: roles.object?.sourcedId ?? null,
  });

  // Journal writes. INSERT OR IGNORE is the merge protocol; a row is new
  // evidence only when it actually landed (duplicates leave the chain clean).
  // A newly-landed propagating relation also dirties the
  // encounter log: prior consumes of its subject backfill an encounter with the
  // newly-named target (the album/artist often arrives after the listen).
  const newRelations = new Map<string, { subjectSourcedId: number; targetSourcedId: number }>();
  for (const o of pendingObs) {
    const chain = ctx.dirtyChain(tx, o.subjectId, o.predicate);
    const inserted = tx
      .insert(observations)
      .values({
        subjectId: o.subjectId,
        predicate: o.predicate,
        validAt: o.validAt,
        observedAt: o.observedAt,
        valueId: o.valueId,
        valueSourcedId: o.valueSourcedId,
        valueLocationId: o.valueLocationId,
        actionId,
        assertionId,
        grade: o.grade,
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes > 0) {
      chain.recordNewRow({ validAt: o.validAt, observedAt: o.observedAt });
      ctx.trace({
        phase: 'shred',
        step: 'observe',
        subject: o.subjectId,
        predicate: o.predicate,
        validAt: o.validAt,
        observedAt: o.observedAt,
      });
      if (o.valueSourcedId !== null && isPropagatingRelation(o.predicate)) {
        newRelations.set(`${o.subjectId}:${o.valueSourcedId}`, {
          subjectSourcedId: o.subjectId,
          targetSourcedId: o.valueSourcedId,
        });
      }
    }
  }
  // Backfill before the current action's own encounter is emitted below, so it
  // only touches prior consumes (the current one is path A's job).
  for (const { subjectSourcedId, targetSourcedId } of newRelations.values()) {
    backfillTransitiveEncounters(tx, {
      objectEntityId: liveEntityId(subjectSourcedId),
      targetEntityId: liveEntityId(targetSourcedId),
    });
  }

  for (const m of pendingMetrics) {
    tx.insert(metrics)
      .values({ ...m, entityId: liveEntityId(m.sourcedEntityId), actionId })
      .onConflictDoNothing()
      .run();
  }

  // Special-property chains this action participates in (as opener or closer).
  if (roles.object) {
    for (const def of specialPredicatesFor(actionType)) {
      ctx.dirtySpecialChain(roles.object.sourcedId, def.predicate, roles.agent?.sourcedId ?? null);
      ctx.trace({
        phase: 'shred',
        step: 'special-dirty',
        object: roles.object.sourcedId,
        predicate: def.predicate,
        agent: roles.agent?.sourcedId ?? null,
      });
    }
  }

  // Encounter event log: append one point-event row per interaction
  // instance, idempotent on the originating action (drop its prior rows, then
  // re-emit). The recipient/channel a message needs were already interned when
  // the shred recursed into the object node, so their sourced ids are read off
  // the pending observation rows rather than re-queried.
  const emit = encounterEmitFor(actionType);
  if (emit) {
    tx.delete(encounters).where(eq(encounters.originatingActionId, actionId)).run();

    let subjectSourcedId: number | null = null;
    if (roles.object) {
      if (emit.kind === 'object') {
        subjectSourcedId = roles.object.sourcedId;
      } else {
        // message: a group post belongs to its Channel (`isPartOf`); a DM names
        // its partner via the first `recipient`. Check the Channel first — a
        // group message also carries a `recipient` ([me] on incoming).
        const objectSourced = roles.object.sourcedId;
        const channel = pendingObs.find(
          o =>
            o.subjectId === objectSourced && o.predicate === 'isPartOf' && o.valueSourcedId !== null
        );
        const recipient = pendingObs.find(
          o =>
            o.subjectId === objectSourced &&
            o.predicate === 'recipient' &&
            o.valueSourcedId !== null
        );
        subjectSourcedId = channel?.valueSourcedId ?? recipient?.valueSourcedId ?? null;
      }
    }

    if (subjectSourcedId !== null) {
      // cached_timestamp tracks the action's occurred_at (min/max-wins narrowed
      // across every event sharing the key), so read it back post-upsert.
      // occurred_at = COALESCE(time_earliest, asserted_at); asserted_at is NOT
      // NULL, so it never resolves null (the ?? only satisfies the column type).
      const cachedTimestamp =
        tx
          .select({ occurredAt: actions.occurredAt })
          .from(actions)
          .where(eq(actions.id, actionId))
          .get()!.occurredAt ?? rootObservedAt;
      const encountererSourcedId = roles.agent?.sourcedId ?? null;
      const encountererEntityId = roles.agent ? liveEntityId(roles.agent.sourcedId) : null;
      tx.insert(encounters)
        .values({
          originatingActionId: actionId,
          cachedTimestamp,
          encountererSourcedId,
          encountererEntityId,
          subjectSourcedId,
          subjectEntityId: liveEntityId(subjectSourcedId),
          level: emit.level,
        })
        .run();

      // Phase 2: encountering the object also encounters its allowlisted
      // relation targets (a track's album/artist). Only for object-kind emits —
      // a message's recipient/channel doesn't propagate.
      if (emit.kind === 'object') {
        emitTransitiveEncounters(tx, {
          actionId,
          objectEntityId: liveEntityId(subjectSourcedId),
          encountererSourcedId,
          encountererEntityId,
          cachedTimestamp,
        });
      }
    }
  }
}
