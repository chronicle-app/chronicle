import { DERIVED_EFFECTS, getAllSubtypes } from './schema.js';
import { getPredicateAnnotation } from './ontology.js';

/**
 * Action-type register: the ontology-side mapping the fold engine branches on.
 * Everything here is derived from event content (the payload @type), so every
 * consumer stays convergent. Type sets are subtype-expanded once and cached.
 */

function expand(types: string[]): Set<string> {
  return new Set(types.flatMap(t => [t, ...getAllSubtypes(t)]));
}

// ---------------------------------------------------------------------------
// Origin grade
// ---------------------------------------------------------------------------

/**
 * Observations shredded from the `result` subtree of these actions are
 * origin-grade: the source asserts the thing came into being here, so its
 * properties at that placement are known, not merely sighted.
 */
const ORIGIN_RESULT_TYPES = expand(['CreateAction']);

/** Actions whose `object` is origin-grade existence-END evidence. */
const DELETE_TYPES = expand(['DeleteAction']);

export function isOriginResultType(type: string): boolean {
  return ORIGIN_RESULT_TYPES.has(type);
}

export function isDeleteType(type: string): boolean {
  return DELETE_TYPES.has(type);
}

/** Delete-subtree type names, for SQL IN clauses. */
export function deleteTypeNames(): string[] {
  return [...DELETE_TYPES];
}

export const GRADE_OBSERVED = 0;
export const GRADE_ORIGIN = 1;

// ---------------------------------------------------------------------------
// Special properties (encountered / liked / consuming / completed)
// ---------------------------------------------------------------------------

/**
 * Materialized as ordinary `properties` rows with the agent columns set; the
 * substrate is an action scan (the actions table is already their record).
 * Openers open (or extend) a presence run on the chain
 * (object sourced entity, predicate, agent); closers close the open run.
 */
export interface SpecialPropertyDef {
  predicate: string;
  openers: Set<string>;
  closers: Set<string>;
}

// Generated lists already resolve subtype inheritance and exact-type rules.
const SPECIAL_PROPERTY_DEFS: SpecialPropertyDef[] = DERIVED_EFFECTS.runs.map(def => ({
  predicate: def.predicate,
  openers: new Set(def.openers),
  closers: new Set(def.closers),
}));

export function getSpecialPropertyDefs(): SpecialPropertyDef[] {
  return SPECIAL_PROPERTY_DEFS;
}

/** Special predicates an action type participates in (as opener or closer). */
export function specialPredicatesFor(type: string): SpecialPropertyDef[] {
  return SPECIAL_PROPERTY_DEFS.filter(d => d.openers.has(type) || d.closers.has(type));
}

const SPECIAL_PREDICATES = new Set(SPECIAL_PROPERTY_DEFS.map(d => d.predicate));

export function isSpecialPredicate(predicate: string): boolean {
  return SPECIAL_PREDICATES.has(predicate);
}

export function getSpecialPropertyDef(predicate: string): SpecialPropertyDef | undefined {
  return SPECIAL_PROPERTY_DEFS.find(d => d.predicate === predicate);
}

// ---------------------------------------------------------------------------
// Persistence class + lifecycle facets
// ---------------------------------------------------------------------------

/**
 * How the fold physically stores / resolves a predicate. Derived from the
 * ontology annotation where it can be (range, metric, identity effect);
 * Special runs use generated TTL effects. Lifecycle facets remain explicit
 * registrations here.
 *
 * - `attribute`       literal-valued run (name, genre)
 * - `relation`        entity-valued edge run (author, home, worksFor)
 * - `lifecycle-facet` a facet of a dated Occurrence (datePublished → its
 *                     timestamp); resolves through the occurrence, never a row
 * - `metric`          numeric stream (heartRate) → metrics table
 * - `special`         reaction run driven by an action scan (liked, follows)
 * - `identity`        merge/cut machinery (sameAs, differentFrom)
 */
export type PersistenceClass =
  'attribute' | 'relation' | 'lifecycle-facet' | 'metric' | 'special' | 'identity';

/**
 * A lifecycle-facet predicate is a DATE that becomes the `timestamp` of an
 * agentless {@link isOccurrenceType Occurrence}: `datePublished` is the time of
 * the work's PublishAction; the scalar never persists as a property value
 * at all. ONLY dates ride occurrences. Place and agent facts
 * (`birthPlace`, `author`) stay ordinary property edges — the occurrence is at
 * most their *originator* (it opens the edge's validity), never their home.
 */
export interface LifecycleFacetDef {
  /** The agentless occurrence type whose timestamp this date is (an existing action type). */
  occurrence: string;
}

const LIFECYCLE_FACETS: Record<string, LifecycleFacetDef> = {
  datePublished: { occurrence: 'PublishAction' },
  dateCreated: { occurrence: 'CreateAction' },
  birthDate: { occurrence: 'BirthAction' },
  deathDate: { occurrence: 'DeathAction' },
};

export function getLifecycleFacet(predicate: string): LifecycleFacetDef | undefined {
  return LIFECYCLE_FACETS[predicate];
}

// Reverse of LIFECYCLE_FACETS (1:1): the date predicate an occurrence type
// renders back to on serialization — a PublishAction's time is `datePublished`.
const OCCURRENCE_DATE_PREDICATE: Record<string, string> = Object.fromEntries(
  Object.entries(LIFECYCLE_FACETS).map(([predicate, def]) => [def.occurrence, predicate])
);

export function getOccurrenceDatePredicate(occurrenceType: string): string | undefined {
  return OCCURRENCE_DATE_PREDICATE[occurrenceType];
}

/** Occurrence types that carry a renderable date facet, for SQL `IN` clauses. */
export function occurrenceDateTypes(): string[] {
  return Object.keys(OCCURRENCE_DATE_PREDICATE);
}

export function isLifecycleFacet(predicate: string): boolean {
  return Object.hasOwn(LIFECYCLE_FACETS, predicate);
}

/**
 * Agentless occurrence types: dated markers with no doer, reused from
 * the existing action vocabulary. A scalar-only date mints one of these with a
 * null agent; participants (`author`, `publisher`) are edges, never its agent.
 */
const OCCURRENCE_TYPES = expand(Object.values(LIFECYCLE_FACETS).map(d => d.occurrence));

export function isOccurrenceType(type: string): boolean {
  return OCCURRENCE_TYPES.has(type);
}

/**
 * A real occurrence action can *state* place/agent facts that belong on the
 * object as edges, not on the agentless occurrence: a `BirthAction`'s `location`
 * is the person's `birthPlace`; a `CreateAction`'s `agent` is the work's
 * `author`. The fold routes the action's role slot to a property edge on its
 * object (reverse-indexable), leaving the occurrence to carry only the date —
 * so `BirthAction{location}` and a bare `birthPlace:` scalar land the same way.
 */
export interface OccurrenceEdgeFacet {
  /** the occurrence action's role slot that carries the fact */
  role: 'location' | 'agent';
  /** the property edge it becomes on the action's object */
  predicate: string;
}

const OCCURRENCE_EDGE_FACETS: Record<string, OccurrenceEdgeFacet[]> = {
  BirthAction: [{ role: 'location', predicate: 'birthPlace' }],
  DeathAction: [{ role: 'location', predicate: 'deathPlace' }],
  // A move states where the mover lives from that date: `MoveAction{location}`
  // opens the object's `home` run at the move's occurrence, not the crawl — the
  // next move's competing value closes it (cardinality-one coalescing), so a
  // chain of moves yields residence history even from a snapshot source.
  MoveAction: [{ role: 'location', predicate: 'home' }],
  // The general creation credit — `author`/`director`/`artist` are its
  // subproperties. A generic CreateAction can't know the work's medium, so it
  // maps to `creator`; a source that knows better emits the specific edge.
  CreateAction: [{ role: 'agent', predicate: 'creator' }],
  // PublishAction is specifically a release, so the specific role fits.
  PublishAction: [{ role: 'agent', predicate: 'publisher' }],
};

export function getOccurrenceEdgeFacets(type: string): OccurrenceEdgeFacet[] {
  return OCCURRENCE_EDGE_FACETS[type] ?? [];
}

/**
 * The persistence class of a predicate. `lifecycle-facet` and `special` are
 * explicit registrations; everything else derives from the ontology annotation
 * (metric flag → metric, identity effect → identity, entity vs literal range →
 * relation vs attribute). An unknown predicate defaults to `attribute`.
 */
export function getPersistenceClass(predicate: string): PersistenceClass {
  if (isLifecycleFacet(predicate)) return 'lifecycle-facet';
  if (isSpecialPredicate(predicate)) return 'special';
  const ann = getPredicateAnnotation(predicate);
  if (!ann) return 'attribute';
  if (ann.metric) return 'metric';
  // An identity edge is pure machinery UNLESS it is also observed: `canonicalVersion`
  // merges like `sameAs` and additionally records a value that can change, so it
  // routes like any other relation.
  if ((ann.identityEffect === 'merge' || ann.identityEffect === 'cut') && !ann.observed)
    return 'identity';
  return ann.isEntityRange ? 'relation' : 'attribute';
}

// ---------------------------------------------------------------------------
// Encounter predicate
// ---------------------------------------------------------------------------

/**
 * Reverse-lookup predicates served by the `encounters` event log
 * rather than a `properties` run — recognized here, not via
 * {@link isSpecialPredicate}.
 *
 * - `encountered` (level `encounter`) is **directional**: you encountered the
 *   subject (a book, a place), never the reverse — so the queried entity is
 *   only ever the subject.
 * - `interactedWith` (level `interaction`) is **bidirectional**: an exchange is
 *   symmetric, so the queried entity matches whether it sent or received — it
 *   may appear as either subject or encounterer.
 */
export interface EncounterPredicateDef {
  level: 'encounter' | 'interaction';
  bidirectional: boolean;
}

const ENCOUNTER_PREDICATE_DEFS: Record<string, EncounterPredicateDef> =
  DERIVED_EFFECTS.encounterPredicates;

export function isEncounterPredicate(predicate: string): boolean {
  return Object.hasOwn(ENCOUNTER_PREDICATE_DEFS, predicate);
}

export function getEncounterPredicate(predicate: string): EncounterPredicateDef | undefined {
  return ENCOUNTER_PREDICATE_DEFS[predicate];
}

/**
 * Encounter emit policy: every action you take on a thing is an
 * engagement with it, so any action with an object appends an encounter — read
 * a book, like a post, visit a place, create or complete a task. The subject is
 * the action's object (one-directional contact → level `encounter`), with one
 * exception: a message, whose object is the Message envelope, not the
 * counterpart. There the subject is the counterpart — the Channel (a group, via
 * `isPartOf`) else the first `recipient` (a DM) — and a two-way exchange grades
 * as `interaction`. An action with no object (or a bare lat/long that resolves
 * no place entity) emits nothing.
 */
export type EncounterEmit =
  { kind: 'object'; level: 'encounter' } | { kind: 'message'; level: 'interaction' };

export function encounterEmitFor(type: string): EncounterEmit | undefined {
  const effect = DERIVED_EFFECTS.encounters[type];
  if (!effect) return undefined;
  const { declaredOn: _declaredOn, ...emit } = effect;
  return emit;
}

/**
 * Transitive encounter propagation: relations on a consumed
 * object that propagate the encounter to their target — a curated allowlist,
 * one hop, not a graph closure. Two families: containment (the object is part
 * of the target — a song's `inAlbum`, an episode's `series`) and attribution
 * (the target made/performed the object — a book's `author`, a track's
 * `artist`). Inverse relations (`hasPart`/`track`) are deliberately absent:
 * encountering an album is not encountering every track on it. All transitive
 * rows are level `encounter`.
 */
const PROPAGATING_RELATIONS = new Set(DERIVED_EFFECTS.propagatingRelations);

export function isPropagatingRelation(predicate: string): boolean {
  return PROPAGATING_RELATIONS.has(predicate);
}

/** The propagating-relation predicate names, for SQL `IN` clauses. */
export function propagatingRelationNames(): string[] {
  return [...PROPAGATING_RELATIONS];
}
