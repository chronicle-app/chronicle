/**
 * The lowered constraint IR the persistence evaluator consumes. The parser's
 * surface AST (ast.ts) lowers to these nodes in
 * core/persistence/src/query/cql.ts; the evaluator compiles them to SQL.
 */

export type QueryAST = ConstraintNode[];

/**
 * Temporal modifier for property/association period filtering
 */
export type TemporalModifier =
  | 'current'
  | 'ever'
  | 'past'
  | { at: string }
  | { during: [string, string] }
  | { before: string }
  | { after: string }
  /** Containment: the run covers the whole [start, end) window. */
  | { throughout: [string, string] }
  /** Observed axis: the run as believed strictly before this instant. */
  | { asof: string }
  /**
   * `@t`: this row's event time. Resolved by the compiler to the
   * enclosing action's occurrence inside a role traversal; unresolved uses error.
   */
  | { atAnchor: 't' };

export type ConstraintNode =
  | TypeConstraint
  | PropertyConstraint
  | AssociationConstraint
  | FullTextConstraint
  | SimilarConstraint
  | OrConstraint
  | AndConstraint
  | PseudoEdgeConstraint;

/**
 * A value-position anchor token: it resolves to a specific entity at evaluation
 * time rather than matching a literal or an elected name. The sole anchor today
 * is `@me` — the self hub — but the shape is a small reserved
 * set so a future egocentric anchor (`@home`, `@primary-device`) is a new
 * `anchor` value, not new parsing machinery. The parser stays storage-agnostic:
 * it only emits this typed value; the persistence evaluator knows the hub keyset
 * and resolves the `entity_id`.
 */
export interface AnchorValue {
  anchor: 'me';
}

/** A constraint's value: a literal string, or a typed anchor token (e.g. `@me`). */
export type ConstraintValue = string | AnchorValue;

/** Narrow a constraint value to the typed anchor form. */
export function isAnchorValue(value: ConstraintValue | undefined): value is AnchorValue {
  return typeof value === 'object' && value !== null && 'anchor' in value;
}

export interface TypeConstraint {
  type: 'type';
  value: string;
  negated?: boolean;
}

export interface PropertyConstraint {
  type: 'property';
  property: string;
  /**
   * `gt`/`gte`/`lt`/`lte` and `range` come from the lowering.
   */
  operator: 'equals' | 'exists' | 'before' | 'after' | 'gt' | 'gte' | 'lt' | 'lte' | 'range';
  value?: ConstraintValue;
  /** Inclusive upper bound when `operator` is `range` (`value` is the lower). */
  value2?: ConstraintValue;
  /**
   * Reducer over the field's value SET before comparing:
   * `first(encountered):<2015` folds the encounter timestamps with MIN.
   * Emitted only for encounter predicates today.
   */
  reduce?: 'min' | 'max';
  negated?: boolean;
  temporal?: TemporalModifier;
}

export interface AssociationConstraint {
  type: 'association';
  property: string;
  constraints: ConstraintNode[];
  negated?: boolean;
  temporal?: TemporalModifier;
  /**
   * Cardinality: a count comparison on matching neighbors, or
   * `every` (all neighbors match, non-vacuously — at least one must exist).
   * Absent = the default existence probe; `none` is `negated` existence.
   */
  cardinality?: { cmp: '=' | '>' | '>=' | '<' | '<='; n: number } | 'every';
  /**
   * Co-occurrence window in ms, `with(1d):{…}` — only meaningful on
   * the `with` edge over the encounters log. Absent = same originating action.
   */
  gapMs?: number | [number, number];
}

export interface FullTextConstraint {
  type: 'fulltext';
  value: string;
  negated?: boolean;
}

/**
 * Semantic similarity (`~"text"`). The evaluator cannot embed — that
 * needs a model — so a host resolves each node's text to a ranked entity id
 * list (nearest first) over the per-device vector index and passes the
 * resolutions in with the query options; the compiled constraint is membership
 * in that list. Ranking is whole-entity (the embedding card), which is why the
 * operator is bare rather than field-scoped.
 */
export interface SimilarConstraint {
  type: 'similar';
  text: string;
  negated?: boolean;
}

export interface OrConstraint {
  type: 'or';
  constraints: ConstraintNode[];
}

export interface AndConstraint {
  type: 'and';
  constraints: ConstraintNode[];
}

/**
 * Temporal-relational pseudo-edge: the relation is the edge name,
 * the anchor is a sub-query, and `gap` is the distance window in ms. `while`
 * anchors on a validity state pinned at the row's own occurrence; the event
 * edges compare the row's time against the anchor action set's span.
 */
export interface PseudoEdgeConstraint {
  type: 'pseudoEdge';
  edge: 'while' | 'after' | 'before' | 'since' | 'until' | 'near';
  anchor: ConstraintNode[];
  /** Strict upper bound on the gap in ms, or an inclusive [lo, hi] range. */
  gapMs?: number | [number, number];
  negated?: boolean;
}
