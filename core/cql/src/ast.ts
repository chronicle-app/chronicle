/**
 * The CQL surface AST. A query is a node predicate: `result = { n | pred(n) }`.
 * Every term restricts the root set; traversal filters by neighbor-existence
 * and never multiplies rows. The parser is storage-agnostic — it emits typed
 * terms and leaves meaning (schema routing, date resolution, anchor identity)
 * to the compiler.
 */

/** A parsed query: the conjunction of its terms (space = AND). */
export type Query = Term[];

export type Term = FieldTerm | TextTerm | SimilarTerm | ScopeTerm | AnchorTerm | OrTerm;

/**
 * A scalar in value position. The parser records lexical shape only; whether a
 * `word` is a number, a partial date, or a keyword is the compiler's call —
 * `rating:2019` and `timestamp:2019` parse identically.
 */
export type ScalarValue =
  | { kind: 'string'; value: string }
  | { kind: 'word'; value: string }
  | { kind: 'anchor'; name: string };

/** some/none/every quantify a traversal; count compares the neighbor count. */
export type Quantifier =
  { q: 'some' | 'none' | 'every' } | { q: 'count'; cmp: '=' | '>' | '>=' | '<' | '<='; n: number };

export type ValuePredicate =
  | { op: 'eq'; values: ScalarValue[] }
  | { op: 'cmp'; cmp: '>' | '>=' | '<' | '<='; value: ScalarValue }
  | { op: 'range'; lo: ScalarValue; hi: ScalarValue }
  | { op: 'exists' };

/**
 * `name:value`-shaped term: a scalar comparison, a `{}` traversal, or both
 * (edge constraints + a target sub-query). `type:` is an ordinary field — the
 * compiler routes it, keeping the grammar uniform.
 */
export interface FieldTerm {
  kind: 'field';
  field: string;
  /** Reducer/transform wrapping the field: `avg(rating)`, `year(timestamp)`. */
  fn?: string;
  /**
   * `()` constraints on the edge itself (`recipient(type:cc)`), parsed with the
   * full term grammar. Positional shorthand (`after(2w)`) lands in `edgeValue`.
   */
  edge?: Query;
  edgeValue?: ScalarValue;
  quantifier?: Quantifier;
  predicate?: ValuePredicate;
  /** `{}` sub-query on the referenced node; restriction, never multiplication. */
  subquery?: Query;
  negated?: boolean;
}

/** Bare quoted text: hybrid full-text over the node (lexical + semantic). */
export interface TextTerm {
  kind: 'text';
  value: string;
  negated?: boolean;
}

/**
 * Bare `~"text"`: semantic similarity over the whole node. Similarity ranks
 * entities against their embedding card, so it takes no field — like a bare
 * text term, it is a predicate on the node itself. `~@anchor` parses to an
 * anchor value (similar-to-an-entity; compiler support pending).
 */
export interface SimilarTerm {
  kind: 'similar';
  value: ScalarValue;
  negated?: boolean;
}

/**
 * Temporal scope wrapping a sub-query. `during`/`throughout` pin validity to a
 * window (overlap vs containment); `asof` re-reads the observed dimension;
 * `current`/`past`/`ever` are validity states relative to now (no window).
 */
export interface ScopeTerm {
  kind: 'scope';
  scope: 'during' | 'throughout' | 'asof' | 'current' | 'past' | 'ever';
  window?: ScalarValue;
  body: Query;
  negated?: boolean;
}

/** A bare anchor as an identity constraint on the root: `@me employer:{...}`. */
export interface AnchorTerm {
  kind: 'anchor';
  name: string;
  negated?: boolean;
}

/** `a | b` between term groups; each group is itself a conjunction. */
export interface OrTerm {
  kind: 'or';
  groups: Query[];
}
