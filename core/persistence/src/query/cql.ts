/**
 * CQL lowering: the parsed surface AST maps onto the evaluator's
 * correlated-EXISTS compiler — brace traversal is association-existence,
 * `-field:{…}` and `none{…}` are the same NOT EXISTS, value sets are OR, and
 * scalar comparisons ride the property/metric paths.
 *
 * Constructs that are not implemented yet throw UnsupportedConstraintError
 * naming what they need — a query surface says "not yet" out loud, never a
 * silently-empty result.
 */

import {
  inferQueryTarget,
  type ConstraintNode,
  type ConstraintValue,
  type PseudoEdgeConstraint,
} from '@chronicle.app/cql';
import type {
  FieldTerm,
  Query,
  ScalarValue,
  ScopeTerm,
  TemporalModifier,
  Term,
} from '@chronicle.app/cql';
import type { SqliteDriver } from '../db/driver.js';
import { parseDateRange, relativeDateRange } from '../time.js';
import { getAllPredicateAnnotations, inverseNames } from '../annotations/ontology.js';
import { getSpecialPropertyDefs } from '../annotations/actionTypes.js';
import {
  countActions,
  countEntities,
  queryActionPage,
  queryEntityPage,
  UnsupportedConstraintError,
  type ActionQueryOptions,
  type ActionQueryPage,
  type QueryOptions,
  type QueryPage,
  type SimilarResolutions,
} from './evaluate.js';
import { countActionsBy, countEntitiesBy } from './summary.js';
import type { CountBucket, CountByDimension } from './summary.js';

const CMP_OPERATOR = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' } as const;

/** Lower a parsed CQL AST to the evaluator's constraint nodes. */
export interface LowerOptions {
  /** Reference instant for relative dates (`-7d`, `today`); defaults to now. */
  now?: number;
}

interface LowerContext {
  now: number;
}

export function lowerQuery(ast: Query, options: LowerOptions = {}): ConstraintNode[] {
  const ctx: LowerContext = { now: options.now ?? Date.now() };
  return ast.map(term => translateTerm(term, ctx));
}

export type QueryPageOutcome =
  ({ target: 'actions' } & ActionQueryPage) | ({ target: 'entities' } & QueryPage);

/** Evaluate a parsed CQL AST, routing to the entity or action engine by its root. */
export function queryPage(
  sqlite: SqliteDriver,
  ast: Query,
  options: ActionQueryOptions & QueryOptions = {}
): QueryPageOutcome {
  const lowered = lowerQuery(ast, { now: options.at });
  return inferQueryTarget(lowered) === 'actions'
    ? { target: 'actions', ...queryActionPage(sqlite, lowered, options) }
    : { target: 'entities', ...queryEntityPage(sqlite, lowered, options) };
}

/** Count the survivors without materializing them. */
export function queryCount(
  sqlite: SqliteDriver,
  ast: Query,
  options: LowerOptions & { similar?: SimilarResolutions } = {}
): { target: 'actions' | 'entities'; count: number } {
  const lowered = lowerQuery(ast, options);
  const similar = { similar: options.similar };
  return inferQueryTarget(lowered) === 'actions'
    ? { target: 'actions', count: countActions(sqlite, lowered, similar) }
    : { target: 'entities', count: countEntities(sqlite, lowered, similar) };
}

/** Bucket the survivors by a dimension (`type`, `source`, `timestamp:year|month|day`). */
export function queryCountBy(
  sqlite: SqliteDriver,
  ast: Query,
  dim: CountByDimension,
  options: LowerOptions & { similar?: SimilarResolutions } = {}
): { target: 'actions' | 'entities'; buckets: CountBucket[] } {
  const lowered = lowerQuery(ast, options);
  const similar = { similar: options.similar };
  return inferQueryTarget(lowered) === 'actions'
    ? { target: 'actions', buckets: countActionsBy(sqlite, lowered, dim, similar) }
    : { target: 'entities', buckets: countEntitiesBy(sqlite, lowered, dim, similar) };
}

/**
 * Every `~` text in a lowered query, deduplicated. The evaluator is synchronous
 * and cannot embed; a host embeds these (against the per-device vector index)
 * and passes the ranked-id resolutions back through the query options.
 */
export function collectSimilarTexts(ast: ConstraintNode[]): string[] {
  const texts = new Set<string>();
  const walk = (nodes: ConstraintNode[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'similar':
          texts.add(node.text);
          break;
        case 'and':
        case 'or':
        case 'association':
          walk(node.constraints);
          break;
        case 'pseudoEdge':
          walk(node.anchor);
          break;
        default:
          break;
      }
    }
  };
  walk(ast);
  return [...texts];
}

function translateTerm(term: Term, ctx: LowerContext): ConstraintNode {
  switch (term.kind) {
    case 'text':
      return { type: 'fulltext', value: term.value, ...negated(term.negated) };
    case 'similar': {
      if (term.value.kind === 'anchor') {
        throw new UnsupportedConstraintError(
          `~@${term.value.name} (similar to an entity) is not supported yet; only text similarity (~"…") is.`
        );
      }
      if (term.negated === true) {
        throw new UnsupportedConstraintError(
          `Negated "~" needs a distance threshold; only positive ~"…" ranking is supported.`
        );
      }
      return { type: 'similar', text: term.value.value };
    }
    case 'or':
      return {
        type: 'or',
        constraints: term.groups.map(group => ({
          type: 'and',
          constraints: group.map(t => translateTerm(t, ctx)),
        })),
      };
    case 'anchor':
      throw new UnsupportedConstraintError(
        `A bare @${term.name} root constraint is not supported yet.`
      );
    case 'scope':
      return translateScope(term, ctx);
    case 'field':
      return translateField(term, ctx);
  }
}

/**
 * A temporal scope wraps a sub-query: the modifier pushes down onto every
 * validity-carrying term in its body (property/association probes), leaving
 * type and text terms untouched — they carry no lifespan.
 */
function translateScope(term: ScopeTerm, ctx: LowerContext): ConstraintNode {
  if (term.body.length === 0) {
    throw new UnsupportedConstraintError(`${term.scope}{ } scopes an empty sub-query.`);
  }
  const modifier = scopeModifier(term, ctx);
  const body = term.body.map(t => applyTemporal(translateTerm(t, ctx), modifier));
  if (term.negated === true) {
    const node = body.length === 1 ? body[0] : undefined;
    if (node === undefined || node.type === 'and' || node.type === 'or') {
      throw new UnsupportedConstraintError(
        `Negating a multi-term ${term.scope}{…} scope is not supported yet.`
      );
    }
    return { ...node, negated: node.negated !== true };
  }
  return body.length === 1 ? body[0] : { type: 'and', constraints: body };
}

function scopeModifier(term: ScopeTerm, ctx: LowerContext): TemporalModifier {
  if (term.scope === 'current' || term.scope === 'past' || term.scope === 'ever') {
    return term.scope;
  }
  const { window } = term;
  if (window === undefined) {
    throw new UnsupportedConstraintError(`${term.scope}() needs a window.`);
  }
  if (window.kind === 'anchor') {
    if (window.name === 't') {
      if (term.scope === 'asof') {
        throw new UnsupportedConstraintError(`asof(@t) is not supported.`);
      }
      return { atAnchor: 't' };
    }
    throw new UnsupportedConstraintError(`@${window.name} is not a time window.`);
  }
  const range = parseDateRange(window.value) ?? relativeDateRange(window.value, ctx.now);
  if (range === undefined) {
    throw new UnsupportedConstraintError(
      `"${window.value}" is not a date window for ${term.scope}() — use a date (2019, 2019-06), a relative instant (-7d), or a calendar word (today, last-week).`
    );
  }
  // DateRange is a closed [lower, upper]; run modifiers take [start, end).
  const start = new Date(range.lower).toISOString();
  const end = new Date(range.upper + 1).toISOString();
  if (term.scope === 'during') return { during: [start, end] };
  if (term.scope === 'throughout') return { throughout: [start, end] };
  // asof(2020) reads "as I understood it per 2020" — believed by the window's end.
  return { asof: end };
}

function applyTemporal(node: ConstraintNode, modifier: TemporalModifier): ConstraintNode {
  switch (node.type) {
    case 'property':
    case 'association': {
      if (node.temporal !== undefined) {
        throw new UnsupportedConstraintError(
          `Term "${node.property}" already carries a temporal scope — nested scopes on one term are not supported.`
        );
      }
      return { ...node, temporal: modifier };
    }
    case 'and':
    case 'or':
      return { ...node, constraints: node.constraints.map(c => applyTemporal(c, modifier)) };
    case 'pseudoEdge':
      // Time-bearing, but scope semantics over a relation are unsettled —
      // dropping the window silently would be worse than refusing.
      throw new UnsupportedConstraintError(
        `Temporal scopes over ${node.edge}:{…} are not supported yet — window the relation with ${node.edge}(<gap>) or scope the anchor instead.`
      );
    default:
      return node;
  }
}

// Errors that teach: an unknown field is a loud error with
// suggestions, never a predicate that silently matches nothing.
const BUILTIN_FIELDS = [
  'type',
  'id',
  'attachment',
  'source',
  'sourceId',
  'handle',
  'agent',
  'object',
  'result',
  'instrument',
  'target',
  'location',
  'recipient',
  'attendee',
  'with',
  'timestamp',
  'startTime',
  'endTime',
  'while',
  'after',
  'before',
  'since',
  'until',
  'near',
  'encountered',
  'interactedWith',
];

let vocabulary: Set<string> | undefined;

function fieldVocabulary(): Set<string> {
  vocabulary ??= new Set([
    ...BUILTIN_FIELDS,
    ...getAllPredicateAnnotations().keys(),
    ...getSpecialPropertyDefs().map(def => def.predicate),
    ...inverseNames(),
  ]);
  return vocabulary;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function assertKnownField(name: string): void {
  const vocab = fieldVocabulary();
  if (vocab.has(name)) return;
  const lower = name.toLowerCase();
  const suggestions = [...vocab]
    .map(candidate => ({ candidate, d: editDistance(lower, candidate.toLowerCase()) }))
    .filter(entry => entry.d <= 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(entry => entry.candidate);
  throw new UnsupportedConstraintError(
    `Unknown field "${name}".${suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : ''}`
  );
}

const PSEUDO_EDGES: ReadonlySet<string> = new Set([
  'while',
  'after',
  'before',
  'since',
  'until',
  'near',
]);

function translatePseudoEdge(term: FieldTerm, ctx: LowerContext): ConstraintNode {
  const edge = term.field as PseudoEdgeConstraint['edge'];
  if (term.quantifier !== undefined || term.predicate !== undefined) {
    throw new UnsupportedConstraintError(
      `${edge}: takes an anchor sub-query in braces: ${edge}:{ … }.`
    );
  }
  const anchor = (term.subquery ?? []).map(t => translateTerm(t, ctx));
  if (anchor.length === 0) {
    throw new UnsupportedConstraintError(`${edge}:{ } needs an anchor sub-query.`);
  }
  const gapMs = pseudoGap(term, edge);
  return {
    type: 'pseudoEdge',
    edge,
    anchor,
    ...(gapMs === undefined ? {} : { gapMs }),
    ...negated(term.negated),
  };
}

/** The gap window: positional shorthand `after(2w)`, or `after(gap:<2w)` / `after(gap:1d..1w)`. */
function pseudoGap(term: FieldTerm, edge: string): number | [number, number] | undefined {
  if (term.edgeValue !== undefined) {
    if (term.edgeValue.kind === 'anchor') {
      throw new UnsupportedConstraintError(`@${term.edgeValue.name} is not a duration window.`);
    }
    return parseDurationMs(term.edgeValue.value, edge);
  }
  if (term.edge === undefined) return undefined;
  const [gap, ...rest] = term.edge;
  if (
    rest.length > 0 ||
    gap === undefined ||
    gap.kind !== 'field' ||
    gap.field !== 'gap' ||
    gap.predicate === undefined
  ) {
    throw new UnsupportedConstraintError(
      `${edge}(…) takes a gap window: ${edge}(2w):{ … } or ${edge}(gap:<2w):{ … }.`
    );
  }
  const p = gap.predicate;
  if (p.op === 'cmp' && (p.cmp === '<' || p.cmp === '<=') && p.value.kind === 'word') {
    return parseDurationMs(p.value.value, edge);
  }
  if (p.op === 'range' && p.lo.kind === 'word' && p.hi.kind === 'word') {
    return [parseDurationMs(p.lo.value, edge), parseDurationMs(p.hi.value, edge)];
  }
  throw new UnsupportedConstraintError(
    `gap takes <duration or a lo..hi range: ${edge}(gap:<2w):{ … } or ${edge}(gap:1d..1w):{ … }.`
  );
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function parseDurationMs(raw: string, edge: string): number {
  const m = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(raw);
  if (m === null) {
    throw new UnsupportedConstraintError(
      `"${raw}" is not a duration for ${edge}() — use 45s, 30m, 12h, 3d, 2w.`
    );
  }
  return Number(m[1]) * DURATION_UNITS[m[2]];
}

function translateField(term: FieldTerm, ctx: LowerContext): ConstraintNode {
  assertKnownField(term.field);
  if (PSEUDO_EDGES.has(term.field)) return translatePseudoEdge(term, ctx);
  if (term.fn !== undefined) {
    return translateReducer(term, ctx);
  }
  // `with(1d):{…}` — co-occurrence over the encounters log takes a
  // window like the pseudo-edges do. Other real edges have no edge args yet.
  let gapMs: number | [number, number] | undefined;
  if (term.edge !== undefined || term.edgeValue !== undefined) {
    if (term.field !== 'with') {
      throw new UnsupportedConstraintError(
        `Edge constraints on "${term.field}" are not supported yet.`
      );
    }
    gapMs = pseudoGap(term, 'with');
    if (term.subquery === undefined) {
      throw new UnsupportedConstraintError(
        `with(…) takes an anchor sub-query in braces: with(1d):{ … }.`
      );
    }
  }

  if (term.quantifier !== undefined) {
    // Quantifiers count entity neighbors; on a literal-valued field the count
    // is always zero, and `field:single` is likelier a literal value than the
    // count=1 sugar — refuse loudly rather than silently match nothing.
    const annotation = getAllPredicateAnnotations().get(term.field);
    if (annotation !== undefined && !annotation.isEntityRange) {
      throw new UnsupportedConstraintError(
        `"${term.field}" holds literal values — a quantifier counts entity neighbors. For the value itself, quote it: ${term.field}:"single".`
      );
    }
    const q = term.quantifier;
    const constraints = (term.subquery ?? []).map(t => translateTerm(t, ctx));
    const gap = gapMs === undefined ? {} : { gapMs };
    if (q.q === 'some' || q.q === 'none') {
      // some = EXISTS; none = NOT EXISTS — and `-field:none{…}` unwinds to some.
      const flip = q.q === 'none';
      const isNegated = flip !== (term.negated ?? false);
      return {
        type: 'association',
        property: term.field,
        constraints,
        ...gap,
        ...negated(isNegated),
      };
    }
    if (q.q === 'count') {
      return {
        type: 'association',
        property: term.field,
        constraints,
        cardinality: { cmp: q.cmp, n: q.n },
        ...gap,
        ...negated(term.negated),
      };
    }
    return {
      type: 'association',
      property: term.field,
      constraints,
      cardinality: 'every',
      ...gap,
      ...negated(term.negated),
    };
  }

  if (term.subquery !== undefined) {
    return {
      type: 'association',
      property: term.field,
      constraints: term.subquery.map(t => translateTerm(t, ctx)),
      ...(gapMs === undefined ? {} : { gapMs }),
      ...negated(term.negated),
    };
  }

  const { predicate } = term;
  if (predicate === undefined) {
    throw new UnsupportedConstraintError(`Field "${term.field}" has no predicate.`);
  }
  switch (predicate.op) {
    case 'exists':
      return property(term, 'exists');
    case 'cmp': {
      const bound =
        predicate.cmp === '>' || predicate.cmp === '<=' ? ('upper' as const) : ('lower' as const);
      return {
        ...property(term, CMP_OPERATOR[predicate.cmp]),
        value: scalar(timeValue(term, predicate.value, bound, ctx)),
      };
    }
    case 'range':
      return {
        ...property(term, 'range'),
        value: scalar(timeValue(term, predicate.lo, 'lower', ctx)),
        value2: scalar(timeValue(term, predicate.hi, 'upper', ctx)),
      };
    case 'eq': {
      // A relative word on a time field spans a period: equality means overlap,
      // so it lowers to the period's range. Instants stay equality.
      const [only] = predicate.values;
      if (TIME_FIELDS.has(term.field) && predicate.values.length === 1 && only.kind === 'word') {
        const range = relativeDateRange(only.value, ctx.now);
        if (range !== undefined) {
          if (range.lower === range.upper) {
            return translateEquals(
              term,
              [{ kind: 'word', value: new Date(range.lower).toISOString() }],
              ctx
            );
          }
          return {
            ...property(term, 'range'),
            value: new Date(range.lower).toISOString(),
            value2: new Date(range.upper).toISOString(),
          };
        }
      }
      return translateEquals(term, predicate.values, ctx);
    }
  }
}

const TIME_FIELDS: ReadonlySet<string> = new Set(['timestamp', 'startTime', 'endTime']);

// Reducers: fold a value SET before comparing. Today that set is an
// entity's encounter timestamps — `first(encountered):<2015` is "people I knew
// before 2015". `first`/`last` read naturally for time; `min`/`max` are the
// general spellings.
const REDUCERS: Record<string, 'min' | 'max'> = {
  first: 'min',
  min: 'min',
  last: 'max',
  max: 'max',
};

function translateReducer(term: FieldTerm, ctx: LowerContext): ConstraintNode {
  const reduce = REDUCERS[term.fn!];
  const overEncounters = term.field === 'encountered' || term.field === 'interactedWith';
  if (reduce === undefined || !overEncounters) {
    throw new UnsupportedConstraintError(
      `${term.fn}(${term.field}) is not supported yet — reducers land first over the encounter log: first(encountered):<2015, last(interactedWith):>=2024.`
    );
  }
  const { predicate } = term;
  if (predicate === undefined || term.subquery !== undefined || term.quantifier !== undefined) {
    throw new UnsupportedConstraintError(
      `${term.fn}(${term.field}) compares a time — e.g. ${term.fn}(${term.field}):<2015.`
    );
  }
  const base = {
    type: 'property',
    property: term.field,
    reduce,
    ...negated(term.negated),
  } as const;
  switch (predicate.op) {
    case 'cmp': {
      const bound =
        predicate.cmp === '>' || predicate.cmp === '<=' ? ('upper' as const) : ('lower' as const);
      return {
        ...base,
        operator: CMP_OPERATOR[predicate.cmp],
        value: scalar(timeValue(term, predicate.value, bound, ctx, true)),
      };
    }
    case 'range':
      return {
        ...base,
        operator: 'range',
        value: scalar(timeValue(term, predicate.lo, 'lower', ctx, true)),
        value2: scalar(timeValue(term, predicate.hi, 'upper', ctx, true)),
      };
    case 'eq': {
      if (predicate.values.length === 1) {
        const [only] = predicate.values;
        if (only.kind === 'word') {
          const range = relativeDateRange(only.value, ctx.now);
          if (range !== undefined) {
            return {
              ...base,
              operator: 'range',
              value: new Date(range.lower).toISOString(),
              value2: new Date(range.upper).toISOString(),
            };
          }
        }
        return { ...base, operator: 'equals', value: scalar(only) };
      }
      break;
    }
    default:
      break;
  }
  throw new UnsupportedConstraintError(
    `${term.fn}(${term.field}) takes a date comparison: :<2015, :>=2024-01, :2010..2015, or :2019.`
  );
}

/**
 * Resolve a relative date word on a time field to an absolute ISO instant —
 * the period boundary the operator needs (`>last-week` compares against the
 * week's end; `>=last-week` its start) — so the evaluator only ever sees
 * absolute dates. Non-time fields and absolute values pass through.
 */
function timeValue(
  term: FieldTerm,
  value: ScalarValue,
  bound: 'lower' | 'upper',
  ctx: LowerContext,
  isTimeValued = TIME_FIELDS.has(term.field)
): ScalarValue {
  if (!isTimeValued || value.kind !== 'word') return value;
  const range = relativeDateRange(value.value, ctx.now);
  if (range === undefined) return value;
  return { kind: 'word', value: new Date(range[bound]).toISOString() };
}

function translateEquals(
  term: FieldTerm,
  values: ScalarValue[],
  ctx: LowerContext
): ConstraintNode {
  if (term.field === 'type') {
    const types = values.map(v => {
      const value = scalar(v);
      if (typeof value !== 'string') {
        throw new UnsupportedConstraintError(`type: takes type names, not anchors.`);
      }
      return value;
    });
    return oneOrSet(
      types.map(value => ({ type: 'type', value })),
      term.negated
    );
  }
  return oneOrSet(
    values.map(v => ({
      type: 'property',
      property: term.field,
      operator: 'equals',
      value: scalar(v),
    })),
    term.negated
  );
}

/**
 * A comma set is OR; a negated set excludes every member (De Morgan — v1
 * constraint nodes carry negation per leaf, not per OR group).
 */
function oneOrSet(
  nodes: Array<ConstraintNode & { negated?: boolean }>,
  isNegated: boolean | undefined
): ConstraintNode {
  if (nodes.length === 1) return { ...nodes[0], ...negated(isNegated) };
  if (isNegated === true) {
    return { type: 'and', constraints: nodes.map(n => ({ ...n, negated: true })) };
  }
  return { type: 'or', constraints: nodes };
}

function property(
  term: FieldTerm,
  operator: Extract<ConstraintNode, { type: 'property' }>['operator']
): Extract<ConstraintNode, { type: 'property' }> {
  return { type: 'property', property: term.field, operator, ...negated(term.negated) };
}

function scalar(value: ScalarValue): ConstraintValue {
  if (value.kind === 'anchor') {
    if (value.name === 'me') return { anchor: 'me' };
    if (value.name === 't') {
      throw new UnsupportedConstraintError(`@t correlation is not supported yet.`);
    }
    throw new UnsupportedConstraintError(
      `@${value.name}: content-id anchors land with the id: predicate.`
    );
  }
  return value.value;
}

function negated(flag: boolean | undefined): { negated?: boolean } {
  return flag === true ? { negated: true } : {};
}
