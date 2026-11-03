import { INVERSE_PROPERTIES } from '@chronicle.app/schema';
import { PREDICATE_ANNOTATIONS, type PredicateAnnotation } from './schema.js';

/**
 * Per-predicate metadata the fold engine needs (cardinality, range, metric).
 * Generated from the published `chronicle.ttl` at build time
 * (`PREDICATE_ANNOTATIONS` in `./generated.ts`) and imported as plain data — no
 * ontology parsing at runtime. The engine branches ONLY on this shape, never on
 * type names.
 */

/**
 * Predicates minted by the persistence layer itself, not authored by plugins.
 * They are deliberately NOT in the ontology — that is the authoring contract for
 * payload producers, and nobody writes these by hand (ingest rewrites
 * `contentData` into `attachmentCid`). They still need annotations so the fold
 * records them instead of skipping them as unknown predicates.
 */
const INTERNAL_ANNOTATIONS: PredicateAnnotation[] = [
  {
    predicate: 'attachmentCid',
    cardinality: 'one',
    range: 'Text',
    isEntityRange: false,
    metric: false,
  },
];

let cached: Map<string, PredicateAnnotation> | undefined;

function load(): Map<string, PredicateAnnotation> {
  if (cached) return cached;
  const map = new Map<string, PredicateAnnotation>();
  for (const ann of Object.values(PREDICATE_ANNOTATIONS)) {
    map.set(ann.predicate, ann);
  }
  for (const ann of INTERNAL_ANNOTATIONS) {
    if (!map.has(ann.predicate)) map.set(ann.predicate, ann);
  }
  cached = map;
  return map;
}

/** Annotation for a predicate, or undefined if the ontology doesn't declare it. */
export function getPredicateAnnotation(predicate: string): PredicateAnnotation | undefined {
  return load().get(predicate);
}

/** All declared predicate annotations (predicate -> metadata). */
export function getAllPredicateAnnotations(): Map<string, PredicateAnnotation> {
  return load();
}

/**
 * A virtual inverse edge: a query-surface name that walks its forward
 * property edge backwards (`authorOf` ⟷ `author`). Declared via `:inverseName` on
 * the forward property; never authored, never stored. The action frame has no
 * inverse vocabulary — rooting on the action, the stateful runs, and the
 * encounter log already reach back.
 */
export interface InverseEdgeDef {
  forward: string;
}

export function getInverseEdge(predicate: string): InverseEdgeDef | undefined {
  const forward = INVERSE_PROPERTIES[predicate];
  return forward === undefined ? undefined : { forward };
}

/** Every declared virtual inverse name (query vocabulary). */
export function inverseNames(): string[] {
  return Object.keys(INVERSE_PROPERTIES);
}

let cachedEdges: { merge: string[]; cut: string[]; observed: string[] } | undefined;

/**
 * Identity-edge predicates discovered from the ontology, grouped by effect.
 * `merge` predicates (e.g. `sameAs`) collapse the referenced entity into this
 * one; `cut` predicates (e.g. `differentFrom`) assert non-identity. The fold
 * branches on these instead of hardcoded predicate names.
 */
export function getIdentityEdgePredicates(): {
  merge: string[];
  cut: string[];
  observed: string[];
} {
  if (cachedEdges) return cachedEdges;
  const merge: string[] = [];
  const cut: string[] = [];
  // Identity edges that are ALSO ordinary observations. An edge normally
  // contributes identity and nothing else — it is structural, never a property
  // row. `observed` opts one out of that, so it both merges and records a value
  // with a lifespan (a site's preferred address can change; the merge cannot).
  const observed: string[] = [];
  for (const ann of load().values()) {
    if (ann.identityEffect === 'merge') merge.push(ann.predicate);
    else if (ann.identityEffect === 'cut') cut.push(ann.predicate);
    else continue;
    if (ann.observed) observed.push(ann.predicate);
  }
  cachedEdges = { merge, cut, observed };
  return cachedEdges;
}

export { type PredicateAnnotation, type IdentityEffect } from './schema.js';
