/**
 * The ontology as the fold reads it: per-predicate annotations, the value
 * types and the effects derived from actions, generated from the published
 * `chronicle.ttl` at build time (`./generated.ts`, by
 * `scripts/generate-annotations.js`), so nothing parses the ontology at
 * runtime; and the type and property hierarchy, from `@chronicle.app/schema`.
 */
export { DERIVED_EFFECTS, PREDICATE_ANNOTATIONS, VALUE_TYPES } from './generated.js';
export { getAllSubproperties, getAllSubtypes } from '@chronicle.app/schema';

export type IdentityEffect = 'merge' | 'cut';

export interface PredicateAnnotation {
  predicate: string;
  cardinality: 'one' | 'many';
  /** Datatype/entity range as declared in the ontology. */
  range: string;
  /** True when the range is an entity type (value is a reference, not a literal). */
  isEntityRange: boolean;
  /** True for an aggregated time-series quantity routed to the metrics table. */
  metric: boolean;
  /** Identity-edge semantics, when this predicate is an identity edge. */
  identityEffect?: IdentityEffect;
  /** True when an identity edge is ALSO observed as an ordinary value. */
  observed?: boolean;
}

export interface RunEffect {
  predicate: string;
  declaredOn: string;
  assertedBy: string[];
  assertedByExact: string[];
  retractedBy: string[];
  openers: string[];
  closers: string[];
}
export type EncounterEffect = (
  { kind: 'object'; level: 'encounter' } | { kind: 'message'; level: 'interaction' }
) & { declaredOn: string };
export interface DerivedEffects {
  runs: RunEffect[];
  encounters: Record<string, EncounterEffect>;
  encounterPredicates: Record<
    string,
    { level: 'encounter' | 'interaction'; bidirectional: boolean }
  >;
  propagatingRelations: string[];
}
