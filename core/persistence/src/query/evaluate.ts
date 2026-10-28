import type { SqliteDriver } from '../db/driver.js';
import { getAllSubtypes } from '../annotations/schema.js';
import { parseDateRange, parseInstant } from '../time.js';
import type { DateRange } from '../time.js';
import { getInverseEdge, getPredicateAnnotation } from '../annotations/ontology.js';
import type { InverseEdgeDef } from '../annotations/ontology.js';
import {
  getEncounterPredicate,
  getLifecycleFacet,
  isEncounterPredicate,
  isLifecycleFacet,
  isSpecialPredicate,
  occurrenceDateTypes,
} from '../annotations/actionTypes.js';
import { canonicalJson, valueKey } from '../cid/canonical.js';
import { generateKeysetCID, SELF_HUB_KEYSET } from '../cid/cid.js';
import {
  type ConstraintNode,
  type ConstraintValue,
  type TemporalModifier,
  inferQueryTarget,
  isAnchorValue,
} from '@chronicle.app/cql';

/**
 * Compile a parsed CQL AST to a parameterized SQL predicate over the SQLite
 * cache columns and run it. The nested-EXISTS strategy ports directly; leaves
 * target `properties` (derived validity runs), `entity_types`, `metrics`
 * (metric predicates), and `entities` (elected names).
 *
 * All temporal forms compile against the run's [cached_period_from, cached_period_to)
 * interval, NULL-aware — so current = open, past = closed. NULL cached_period_from is
 * an unknown start and behaves as unbounded. (Aliveness clipping is not applied
 * at query time — entity lifespan is not tracked yet.)
 *
 * Special predicates (liked/consuming/completed/follows) probe their
 * materialized agent-property runs; the encounter predicates
 * (encountered/interactedWith) probe the `encounters` event log instead.
 * Metric predicates compile to a metrics leaf preserving value-at-T =
 * latest-reading-≤-T. Semantic search is not supported (no embeddings in this
 * store) and raises a clear error.
 */
export class UnsupportedConstraintError extends Error {}

/**
 * Sentinel for an unbounded (-infinity) interval start in aggregate ordering.
 * One below the minimum value a JS `Date` can represent (±8.64e15 ms), so it
 * sorts before every real timestamp, including pre-1970 (negative) ones.
 */
const EPOCH_FLOOR = -8_640_000_000_000_001;

// No `@me` data ingested yet → resolve to a sentinel that equals no real
// entity_id (autoincrement ids are positive), so an egocentric query returns
// empty rather than erroring. Egocentric result quality tracks `@me` tagging
// coverage across plugins.
const NO_SELF_MATCH = -1;

interface Ctx {
  params: unknown[];
  sqlite: SqliteDriver;
  /** Cached self entity id: number = resolved, null = no anchor data, undefined = not yet looked up. */
  selfId?: number | null;
  /** Host-resolved `~` similarity: text → ranked entity ids (nearest first). */
  similar?: SimilarResolutions;
  /**
   * The one `~` text acting as the page's sort key (a single top-level `~` on
   * an entity query). That node compiles against the full ranked list —
   * membership is the page window — while every other `~` context
   * (nested, OR, count) is a predicate and cuts at the resolution's threshold.
   */
  rankText?: string;
  /**
   * How many clauses so far read the outer row (a run pinned at the row's own
   * time). A subtree that adds one can't be computed once for every row.
   */
  outerRefs?: number;
}

/** The subject of a `properties` row under `alias`. */
const runSubject = (alias: string) => `${alias}.cached_entity_id`;

/**
 * A count comparison on each subject's matches, from one grouped pass over
 * the matches instead of a count per subject.
 */
function countIn(
  subject: string,
  groups: string,
  card: { cmp: '=' | '>' | '>=' | '<' | '<='; n: number }
): string {
  // `groups` is the subjects with a match, one row each; a subject with none
  // is absent, so when zero passes the count, keep the subjects that aren't
  // among those failing it instead.
  const zeroPasses = {
    '=': card.n === 0,
    '>': card.n < 0,
    '>=': card.n <= 0,
    '<': card.n > 0,
    '<=': card.n >= 0,
  }[card.cmp];
  return zeroPasses
    ? `${subject} NOT IN (${groups} HAVING NOT (COUNT(*) ${card.cmp} ?))`
    : `${subject} IN (${groups} HAVING COUNT(*) ${card.cmp} ?)`;
}

/**
 * Rows of `from` whose `column` is the subject: `subject.id IN (…)` when the
 * rows don't read the outer row, so SQLite computes them once and starts from
 * them instead of probing per subject; else the correlated EXISTS. `column`
 * must be NOT NULL, so the IN form is two-valued under NOT like the EXISTS.
 * Both forms place `where` alike, so the params pushed building it line up.
 */
function subjectIn(
  subject: string,
  column: string,
  from: string,
  where: string,
  correlated: boolean
): string {
  return correlated
    ? `EXISTS (SELECT 1 ${from} WHERE ${column} = ${subject} AND ${where})`
    : `${subject} IN (SELECT ${column} ${from} WHERE ${where})`;
}

/**
 * One resolved `~` text: the ranked entity ids nearest it in the
 * per-device vector index (nearest first), and `cut` — how many of them clear
 * the host's similarity threshold. Predicate contexts keep the `cut` prefix;
 * the ranking context keeps the full list and lets the page window bound it.
 */
export interface SimilarResolution {
  ids: number[];
  cut: number;
}

/**
 * Resolutions for `~` similarity constraints, one per `~` text. The
 * evaluator is synchronous and cannot embed, so the host resolves every text
 * (see `collectSimilarTexts`) before querying and passes the map in.
 */
export type SimilarResolutions = ReadonlyMap<string, SimilarResolution>;

/**
 * Resolve the `@me` self anchor to its entity id, hashing the reserved hub
 * keyset (the same hashing shred uses to mint it) and looking it up once per
 * query. Cached on the context. Returns {@link NO_SELF_MATCH} when no self node
 * has been tagged yet, so the surrounding constraint matches nothing.
 */
function resolveSelf(ctx: Ctx): number {
  if (ctx.selfId === undefined) {
    const key = generateKeysetCID(SELF_HUB_KEYSET);
    const row = ctx.sqlite
      .prepare('SELECT entity_id AS id FROM sourced_entities WHERE key = ? LIMIT 1')
      .get(key) as { id: number } | undefined;
    ctx.selfId = row ? row.id : null;
  }
  return ctx.selfId ?? NO_SELF_MATCH;
}

/**
 * Narrow a constraint value to a literal string at a position where the `@me`
 * anchor is not meaningful (it resolves only in agent/object roles and
 * self-scoped special properties, handled upstream).
 */
/**
 * `@me` as a query VALUE must have a referent — a silent empty result reads as
 * "you have no history" when it means "nothing is tagged". The
 * recency-sort exclusion keeps the sentinel: with no self there is simply
 * nothing to exclude.
 */
/**
 * `id:`: select by content identity. Accepts a full content IRI or a
 * bare keyset hash; ANY member key of a merged cluster resolves to the cluster,
 * so an id picked up before a merge still lands on the merged entity.
 */
function contentKeyOf(value: ConstraintValue): string {
  const literal = requireLiteral(value, 'id').replaceAll(/^<|>$/g, '');
  const slash = literal.lastIndexOf('/');
  return slash === -1 ? literal : literal.slice(slash + 1);
}

function compileContentId(
  node: Extract<ConstraintNode, { type: 'property' }>,
  subjectId: string,
  ctx: Ctx
): string {
  if (node.operator !== 'equals' || node.value === undefined) {
    throw new UnsupportedConstraintError(
      `id: selects by content identity — id:"<content IRI or key>".`
    );
  }
  ctx.params.push(contentKeyOf(node.value));
  return `EXISTS (SELECT 1 FROM sourced_entities se_id WHERE se_id.entity_id = ${subjectId} AND se_id.key = ?)`;
}

/**
 * `attachment:`: the subject carries stored bytes. On an entity it
 * probes the entity's own open attachmentCid run; on an action it reaches
 * through the participant edges to any role entity carrying one. A value
 * narrows by mime class: attachment:"image/*".
 */
function compileAttachment(
  node: Extract<ConstraintNode, { type: 'property' }>,
  entityId: string | undefined,
  actionAlias: string | undefined,
  ctx: Ctx
): string {
  let mime: string | undefined;
  if (node.operator === 'equals' && node.value !== undefined) {
    mime = requireLiteral(node.value, 'attachment').replaceAll('*', '%');
  } else if (node.operator !== 'exists') {
    throw new UnsupportedConstraintError(
      `attachment: takes existence or a mime class — attachment:* or attachment:"image/*".`
    );
  }
  const ap = `ap${ctx.params.length}`;
  ctx.params.push('attachmentCid');
  const scope =
    entityId === undefined
      ? `EXISTS (SELECT 1 FROM action_role_edges ${ap}_re WHERE ${ap}_re.action_id = ${actionAlias}.id AND ${ap}_re.cached_entity_id = ${ap}.cached_entity_id)`
      : `${ap}.cached_entity_id = ${entityId}`;
  let joins = ` JOIN vals ${ap}_v ON ${ap}_v.id = ${ap}.value_id`;
  let mimeClause = '';
  if (mime !== undefined) {
    ctx.params.push(mime);
    joins += ` JOIN attachments ${ap}_att ON ${ap}_att.cid = json_extract(${ap}_v.body, '$')`;
    mimeClause = ` AND ${ap}_att.mime_type LIKE ?`;
  }
  return (
    `EXISTS (SELECT 1 FROM properties ${ap}${joins}` +
    ` WHERE ${ap}.predicate = ? AND ${ap}.cached_period_to IS NULL AND ${scope}${mimeClause})`
  );
}

function requireSelf(ctx: Ctx): number {
  const id = resolveSelf(ctx);
  if (id === NO_SELF_MATCH) {
    throw new UnsupportedConstraintError(
      `@me has no referent: no self-hub in this store yet. A plugin tags the account owner with sameAs: ['@me'].`
    );
  }
  return id;
}

function requireLiteral(value: ConstraintValue, property: string): string {
  if (isAnchorValue(value)) {
    throw new UnsupportedConstraintError(
      `The "@me" anchor is not supported for "${property}" here.`
    );
  }
  return value;
}

/**
 * The content keys of the stored values a literal matches: the literal as a
 * string, and, when its text is itself canonical JSON (a number, a boolean, a
 * quoted string), the value that text encodes. `vals.key` is the hash of
 * `vals.body`, so these are exactly the rows whose body is the literal's JSON
 * or the literal itself.
 */
function literalKeys(literal: string): string[] {
  const keys = [valueKey(literal)];
  try {
    const parsed: unknown = JSON.parse(literal);
    if (canonicalJson(parsed) === literal) keys.push(valueKey(parsed));
  } catch {
    // not JSON text: only the string can match
  }
  return [...new Set(keys)];
}

export interface QueryOptions {
  /** Reference instant for `current` / `past` (kept for API compatibility). */
  at?: number;
  limit?: number;
  /**
   * Keyset cursor from a prior page's `nextCursor`. An entity id by default; a
   * composite `rec_id` token when `recencySort` is set (the two cursor shapes
   * must not be mixed across pages of one sequence).
   */
  cursor?: string;
  /**
   * Order results by recency of their last encounter, most-recent first,
   * instead of the default keyset order by id. `lastSeen` is the union (any
   * encounter on either side, any level — "when I last saw this"); `encountered`
   * / `interactedWith` restrict to one level. Entities with no such encounter
   * sort last.
   */
  recencySort?: 'lastSeen' | 'encountered' | 'interactedWith';
  /**
   * Resolutions for the query's `~` constraints. Required whenever the
   * AST contains a `similar` node; a single top-level `~` also orders the page
   * by its rank (nearest first) unless `recencySort` overrides it.
   */
  similar?: SimilarResolutions;
}

export interface QueryPage {
  ids: number[];
  hasMore: boolean;
  nextCursor?: string;
}

export function queryEntityIds(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: QueryOptions = {}
): number[] {
  return queryEntityPage(sqlite, ast, options).ids;
}

export function queryEntityPage(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: QueryOptions = {}
): QueryPage {
  // A single top-level `~` ranks the filtered set by similarity, nearest
  // first — unless an explicit recency sort overrides it, which demotes the
  // `~` back to a threshold predicate.
  const rank =
    options.recencySort === undefined ? topLevelSimilar(ast, options.similar) : undefined;
  const ctx: Ctx = { params: [], sqlite, similar: options.similar, rankText: rank?.text };
  const whereExpr = ast.length > 0 ? ast.map(node => compile(node, 'e', ctx)).join(' AND ') : '1=1';
  const whereParams = ctx.params; // captured in textual order
  const limit = options.limit ?? 100;

  if (options.recencySort !== undefined) {
    return recencyPage(sqlite, whereExpr, whereParams, limit, options, resolveSelf(ctx));
  }

  if (rank !== undefined) {
    return similarityPage(sqlite, whereExpr, whereParams, limit, options, rank.ids);
  }

  let where = whereExpr;
  const params = [...whereParams];
  if (options.cursor !== undefined) {
    const after = Number(options.cursor);
    if (!Number.isInteger(after)) {
      throw new UnsupportedConstraintError(`Invalid cursor: "${options.cursor}"`);
    }
    params.push(after);
    where += ' AND e.id > ?';
  }
  const sql = `SELECT e.id AS id FROM entities e WHERE ${where} ORDER BY e.id LIMIT ${Number(limit) + 1}`;
  const rows = sqlite.prepare(sql).all(...params) as Array<{ id: number }>;
  const hasMore = rows.length > limit;
  const ids = rows.slice(0, limit).map(r => r.id);
  return {
    ids,
    hasMore,
    ...(hasMore ? { nextCursor: String(ids.at(-1)) } : {}),
  };
}

/**
 * The query's similarity sort key: exactly one non-negated top-level `~` (an
 * AND-chain member, not inside OR or a traversal) makes the page
 * similarity-ordered; any other shape keeps every `~` a threshold predicate
 * under the default ordering.
 */
function topLevelSimilar(
  ast: ConstraintNode[],
  similar?: SimilarResolutions
): { text: string; ids: number[] } | undefined {
  const nodes = ast.filter(n => n.type === 'similar' && n.negated !== true);
  if (nodes.length !== 1) return undefined;
  const { text } = nodes[0] as { text: string };
  const resolution = similar?.get(text);
  if (resolution === undefined) return undefined;
  return { text, ids: resolution.ids };
}

/**
 * Entity page ordered by a `~` constraint's similarity rank, nearest first.
 * The compiled WHERE already restricts membership to the resolved top-K ids
 * (intersected with every other constraint), so the matching set is small; the
 * ordering is the resolution's rank, and the cursor is a plain offset into it
 * (`sim_<n>` — rank order is stable for a fixed resolution).
 */
function similarityPage(
  sqlite: SqliteDriver,
  whereExpr: string,
  whereParams: unknown[],
  limit: number,
  options: QueryOptions,
  ranked: number[]
): QueryPage {
  let offset = 0;
  if (options.cursor !== undefined) {
    const m = /^sim_(\d+)$/.exec(options.cursor);
    if (!m) throw new UnsupportedConstraintError(`Invalid similarity cursor: "${options.cursor}"`);
    offset = Number(m[1]);
  }
  const rows = sqlite
    .prepare(`SELECT e.id AS id FROM entities e WHERE ${whereExpr}`)
    .all(...whereParams) as Array<{ id: number }>;
  const pos = new Map(ranked.map((id, i) => [id, i]));
  const ordered = rows
    .map(r => r.id)
    .filter(id => pos.has(id))
    .sort((a, b) => pos.get(a)! - pos.get(b)!);
  const ids = ordered.slice(offset, offset + limit);
  const hasMore = ordered.length > offset + limit;
  return {
    ids,
    hasMore,
    ...(hasMore ? { nextCursor: `sim_${offset + limit}` } : {}),
  };
}

/**
 * Entity page ordered by recency of the last encounter, newest first. Every
 * entity matching the query is kept — those with no encounter floor to the
 * bottom (so the browser is never mysteriously empty on data that predates the
 * encounter log) — but the self entity is excluded (it is the encounterer of all
 * your own activity, so it would otherwise pin to the top). The `lastSeen` mode
 * is the union (any encounter on either side, any level — "when did I last see
 * this thing"); the predicate modes (`encountered` directional, `interactedWith`
 * bidirectional) restrict to one level. A missing last-encounter floors to
 * EPOCH_FLOOR, so the `(rec, id)` keyset cursor stays a plain composite
 * comparison.
 */
function recencyPage(
  sqlite: SqliteDriver,
  whereExpr: string,
  whereParams: unknown[],
  limit: number,
  options: QueryOptions,
  selfId: number
): QueryPage {
  const mode = options.recencySort!;
  // Lead params land in the inner SELECT, before the WHERE params.
  const leadParams: unknown[] = [];
  let scope: string;
  let levelClause = '';
  if (mode === 'lastSeen') {
    scope = '(en.cached_subject_entity_id = e.id OR en.cached_encounterer_entity_id = e.id)';
  } else {
    const def = getEncounterPredicate(mode);
    if (!def) {
      throw new UnsupportedConstraintError(`Unknown recencySort: "${mode}"`);
    }
    scope = def.bidirectional
      ? '(en.cached_subject_entity_id = e.id OR en.cached_encounterer_entity_id = e.id)'
      : 'en.cached_subject_entity_id = e.id';
    levelClause = 'en.level = ? AND ';
    leadParams.push(def.level);
  }
  const recExpr =
    `COALESCE((SELECT MAX(en.cached_timestamp) FROM encounters en` +
    ` WHERE ${levelClause}${scope}), ${EPOCH_FLOOR})`;

  // textual param order: lead params (inner SELECT), where-params + self id
  // (inner WHERE), then the cursor bounds (outer WHERE).
  const params: unknown[] = [...leadParams, ...whereParams, selfId];
  let cursorClause = '';
  if (options.cursor !== undefined) {
    const m = /^(-?\d+)_(\d+)$/.exec(options.cursor);
    if (!m) throw new UnsupportedConstraintError(`Invalid recency cursor: "${options.cursor}"`);
    cursorClause = ' WHERE rec < ? OR (rec = ? AND id < ?)';
    params.push(Number(m[1]), Number(m[1]), Number(m[2]));
  }
  const sql =
    `SELECT id, rec FROM (` +
    `SELECT e.id AS id, ${recExpr} AS rec FROM entities e WHERE ${whereExpr} AND e.id <> ?` +
    `)${cursorClause} ORDER BY rec DESC, id DESC LIMIT ${Number(limit) + 1}`;
  const rows = sqlite.prepare(sql).all(...params) as Array<{ id: number; rec: number }>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    ids: page.map(r => r.id),
    hasMore,
    ...(hasMore && last ? { nextCursor: `${last.rec}_${last.id}` } : {}),
  };
}

/** `subject` is an `entities` table alias in scope. */
function compile(node: ConstraintNode, subject: string, ctx: Ctx): string {
  switch (node.type) {
    case 'type':
      return maybeNegate(compileType(node.value, subject, ctx), node.negated);
    case 'property':
      if (node.reduce !== undefined) {
        return maybeNegate(compileEncounterReducer(node, subject, ctx), node.negated);
      }
      if (node.property === 'with') {
        if (isAnchorValue(node.value)) {
          return maybeNegate(
            compileCoOccurrence([], undefined, node.temporal, subject, ctx, requireSelf(ctx)),
            node.negated
          );
        }
        const withConstraints: ConstraintNode[] =
          node.operator === 'equals' && node.value !== undefined
            ? [{ type: 'property', property: 'name', operator: 'equals', value: node.value }]
            : [];
        return maybeNegate(
          compileCoOccurrence(withConstraints, undefined, node.temporal, subject, ctx),
          node.negated
        );
      }
      if (node.property === 'id') {
        return maybeNegate(compileContentId(node, `${subject}.id`, ctx), node.negated);
      }
      if (node.property === 'attachment') {
        return maybeNegate(compileAttachment(node, `${subject}.id`, undefined, ctx), node.negated);
      }
      if (getInverseEdge(node.property) !== undefined) {
        return maybeNegate(compileInverseProperty(node, subject, ctx), node.negated);
      }
      if (isEncounterPredicate(node.property)) {
        // `encountered:@me` / `interactedWith:@me` scope the other party to the
        // self entity by identity; `:"Alice"` constrains the other party's name.
        if (isAnchorValue(node.value)) {
          return maybeNegate(
            compileEncounter(node.property, node.temporal, [], subject, ctx, requireSelf(ctx)),
            node.negated
          );
        }
        const encConstraints: ConstraintNode[] =
          node.operator === 'equals' && node.value !== undefined
            ? [{ type: 'property', property: 'name', operator: 'equals', value: node.value }]
            : [];
        return maybeNegate(
          compileEncounter(node.property, node.temporal, encConstraints, subject, ctx),
          node.negated
        );
      }
      if (isSpecialPredicate(node.property)) {
        // `liked:@me` scopes the run to the self agent by identity; `liked:"Alice"`
        // constrains the acting agent's elected name.
        if (isAnchorValue(node.value)) {
          return maybeNegate(
            compileSpecial(node.property, node.temporal, [], subject, ctx, requireSelf(ctx)),
            node.negated
          );
        }
        const constraints: ConstraintNode[] =
          node.operator === 'equals' && node.value !== undefined
            ? [{ type: 'property', property: 'name', operator: 'equals', value: node.value }]
            : [];
        return maybeNegate(
          compileSpecial(node.property, node.temporal, constraints, subject, ctx),
          node.negated
        );
      }
      if (isLifecycleFacet(node.property)) {
        return maybeNegate(compileLifecycleFacet(node, subject, ctx), node.negated);
      }
      if (isSourcedIdentity(node.property)) {
        return maybeNegate(compileSourced(node, subject, ctx), node.negated);
      }
      if (isMetric(node.property)) {
        return maybeNegate(compileMetric(node, subject, ctx), node.negated);
      }
      return maybeNegate(compileProperty(node, subject, ctx), node.negated);
    case 'association':
      // Cardinality is implemented for plain edges and role edges, and loudly
      // rejected everywhere else — never silently degraded to `some`.
      if (
        node.cardinality !== undefined &&
        (node.property === 'with' ||
          isEncounterPredicate(node.property) ||
          isSpecialPredicate(node.property) ||
          isLifecycleFacet(node.property))
      ) {
        throw new UnsupportedConstraintError(
          `Cardinality on "${node.property}" is not supported yet.`
        );
      }
      if (node.property === 'with') {
        return maybeNegate(
          compileCoOccurrence(node.constraints, node.gapMs, node.temporal, subject, ctx),
          node.negated
        );
      }
      if (getInverseEdge(node.property) !== undefined) {
        return maybeNegate(compileInverseAssociation(node, subject, ctx), node.negated);
      }
      if (isEncounterPredicate(node.property)) {
        return maybeNegate(
          compileEncounter(node.property, node.temporal, node.constraints, subject, ctx),
          node.negated
        );
      }
      if (isSpecialPredicate(node.property)) {
        return maybeNegate(
          compileSpecial(node.property, node.temporal, node.constraints, subject, ctx),
          node.negated
        );
      }
      if (isLifecycleFacet(node.property)) {
        return maybeNegate(compileLifecycleFacet(node, subject, ctx), node.negated);
      }
      return maybeNegate(compileAssociation(node, subject, ctx), node.negated);
    case 'fulltext':
      return maybeNegate(compileFullText(node.value, subject, ctx), node.negated);
    case 'similar':
      return maybeNegate(compileSimilar(node.text, subject, ctx), node.negated);
    case 'and':
      return `(${node.constraints.map(c => compile(c, subject, ctx)).join(' AND ')})`;
    case 'or':
      return `(${node.constraints.map(c => compile(c, subject, ctx)).join(' OR ')})`;
    case 'pseudoEdge': {
      if (node.edge === 'while') {
        throw new UnsupportedConstraintError(
          `while:{…} needs an action root — root the query on the action (e.g. type:ReadAction), not the entity.`
        );
      }
      // The entity's own time is its occurrence: a lifecycle action
      // (CreateAction, PublishAction, …) whose object or result is the entity.
      const occ = `oc${ctx.params.length}`;
      const types = [...new Set(occurrenceDateTypes().flatMap(t => [t, ...getAllSubtypes(t)]))];
      ctx.params.push(...types);
      const event = compilePseudoEvent(node, `${occ}.occurred_at`, ctx);
      return maybeNegate(
        `EXISTS (SELECT 1 FROM actions ${occ} WHERE ${occ}.type IN (${types.map(() => '?').join(', ')})` +
          ` AND (${occ}.cached_object_entity_id = ${subject}.id OR ${occ}.cached_result_entity_id = ${subject}.id)` +
          ` AND ${event})`,
        node.negated
      );
    }
    default:
      throw new UnsupportedConstraintError(
        `Constraint "${(node as ConstraintNode).type}" is not supported by the persistence query engine yet.`
      );
  }
}

function maybeNegate(expr: string, negated?: boolean): string {
  return negated ? `NOT (${expr})` : expr;
}

// Numeric comparisons (`pageCount:>=328`, `price:10..20`). Dates
// with granularity rounding are the temporal layer's job — a non-numeric value
// here is a loud error, not a silent epoch coercion.
const NUMERIC_CMP = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

function isNumericOperator(op: string): op is 'gt' | 'gte' | 'lt' | 'lte' | 'range' {
  return op === 'range' || op in NUMERIC_CMP;
}

function requireNumber(value: ConstraintValue | undefined, property: string): number {
  if (value === undefined) {
    throw new UnsupportedConstraintError(`Comparison on "${property}" is missing its value.`);
  }
  const literal = requireLiteral(value, property);
  const num = Number(literal);
  if (!Number.isFinite(num)) {
    throw new UnsupportedConstraintError(
      `"${literal}" is not a number for "${property}" — date comparisons are not supported yet.`
    );
  }
  return num;
}

function isMetric(predicate: string): boolean {
  return getPredicateAnnotation(predicate)?.metric ?? false;
}

function compileType(value: string, subject: string, ctx: Ctx): string {
  const types = [...new Set([value, ...getAllSubtypes(value)])];
  const placeholders = types.map(() => '?').join(', ');
  ctx.params.push(...types);
  return `${subject}.id IN (SELECT entity_id FROM entity_types WHERE type IN (${placeholders}))`;
}

/** Predicate-name placeholder — pushes the name param. */
function predicateExpr(name: string, ctx: Ctx): string {
  ctx.params.push(name);
  return `?`;
}

// ---------------------------------------------------------------------------
// Temporal interval (the run's own [cached_period_from, cached_period_to))
// ---------------------------------------------------------------------------

/**
 * Internal-only modifier (pseudo-edges): pin a run at a correlated SQL
 * expression — the row's own occurrence — instead of a literal instant. Never
 * appears in parsed ASTs; minted by pinAt() for `while:{…}` bodies.
 */
interface AtExprModifier {
  atExpr: string;
}

function isAtExpr(modifier: TemporalModifier | AtExprModifier): modifier is AtExprModifier {
  return typeof modifier === 'object' && 'atExpr' in modifier;
}

function pinAt(node: ConstraintNode, expr: string): ConstraintNode {
  switch (node.type) {
    case 'property':
    case 'association': {
      if (node.temporal !== undefined) {
        throw new UnsupportedConstraintError(
          `Term "${node.property}" carries its own temporal scope inside a while:{…} anchor.`
        );
      }
      return { ...node, temporal: { atExpr: expr } as unknown as TemporalModifier };
    }
    case 'and':
    case 'or':
      return { ...node, constraints: node.constraints.map(c => pinAt(c, expr)) };
    default:
      return node;
  }
}

function compileTemporal(p: string, modifier: TemporalModifier | AtExprModifier, ctx: Ctx): string {
  const from = `${p}.cached_period_from`;
  const to = `${p}.cached_period_to`;

  if (isAtExpr(modifier)) {
    ctx.outerRefs = (ctx.outerRefs ?? 0) + 1;
    return `(${from} IS NULL OR ${from} <= ${modifier.atExpr}) AND (${to} IS NULL OR ${modifier.atExpr} < ${to})`;
  }
  if (typeof modifier === 'object' && 'atAnchor' in modifier) {
    throw new UnsupportedConstraintError(
      `@t is this row's event time — it only resolves inside an action's role traversal (e.g. recipient:{ during(@t){ … } }).`
    );
  }
  if (modifier === 'ever') return '1=1';
  if (modifier === 'current') return `${to} IS NULL`;
  if (modifier === 'past') return `${to} IS NOT NULL`;
  if ('at' in modifier) {
    const t = instant(modifier.at);
    ctx.params.push(t, t);
    return `(${from} IS NULL OR ${from} <= ?) AND (${to} IS NULL OR ? < ${to})`;
  }
  if ('during' in modifier) {
    const [start, end] = modifier.during;
    // effective [from, to) overlaps [start, end)
    ctx.params.push(instant(end), instant(start));
    return `(${from} IS NULL OR ${from} < ?) AND (${to} IS NULL OR ${to} > ?)`;
  }
  if ('throughout' in modifier) {
    // Containment: the run covers the whole [start, end) window. An unknown
    // start (NULL from) behaves as unbounded, matching the module convention.
    const [start, end] = modifier.throughout;
    ctx.params.push(instant(start), instant(end));
    return `(${from} IS NULL OR ${from} <= ?) AND (${to} IS NULL OR ${to} >= ?)`;
  }
  if ('asof' in modifier) {
    // Observed axis: the run as believed strictly before the instant —
    // opened by then, and any closing not yet learned. The valid axis is left
    // open deliberately: what looked current then may be closed now.
    const t = instant(modifier.asof);
    ctx.params.push(t, t);
    return `${p}.first_observed_observed_at < ? AND (${p}.closing_observed_at IS NULL OR ${p}.closing_observed_at >= ?)`;
  }
  if ('before' in modifier) {
    ctx.params.push(instant(modifier.before));
    return `(${from} IS NULL OR ${from} < ?)`;
  }
  // after
  ctx.params.push(instant(modifier.after));
  return `(${to} IS NULL OR ${to} > ?)`;
}

// ---------------------------------------------------------------------------
// Property leaves
// ---------------------------------------------------------------------------

function compileProperty(
  node: Extract<ConstraintNode, { type: 'property' }>,
  subject: string,
  ctx: Ctx
): string {
  const outer = ctx.outerRefs ?? 0;
  // Param push order MUST match placeholder order in the emitted SQL:
  // predicate first, then the temporal clause, then any value comparisons.
  const run = (alias: string) =>
    `${alias}.predicate = ${predicateExpr(node.property, ctx)}` +
    ` AND ${alias}.agent_sourced_id IS NULL` +
    ` AND ${compileTemporal(alias, node.temporal ?? (node.operator === 'exists' ? 'ever' : 'current'), ctx)}`;

  if (node.operator === 'equals' && node.value !== undefined) {
    const literal = requireLiteral(node.value, node.property);
    // dual match: the stored literal value, or the referenced entity's elected
    // name — as two branches, each found from the value side through its own
    // index: the literal's interned values by content key, and the entities
    // elected under the name.
    const keys = literalKeys(literal);
    const byValue = `p${ctx.params.length}`;
    const valueWhere = `${run(byValue)} AND ${byValue}.value_id IN (SELECT id FROM vals WHERE key IN (${keys.map(() => '?').join(', ')}))`;
    ctx.params.push(...keys);
    const byName = `p${ctx.params.length}`;
    const nameWhere = `${run(byName)} AND ${byName}.cached_object_entity_id IN (SELECT id FROM entities WHERE cached_name = ?)`;
    ctx.params.push(literal);
    if ((ctx.outerRefs ?? 0) !== outer) {
      return (
        `(${subjectIn(`${subject}.id`, runSubject(byValue), `FROM properties ${byValue}`, valueWhere, true)}` +
        ` OR ${subjectIn(`${subject}.id`, runSubject(byName), `FROM properties ${byName}`, nameWhere, true)})`
      );
    }
    return (
      `${subject}.id IN (SELECT ${runSubject(byValue)} FROM properties ${byValue} WHERE ${valueWhere}` +
      ` UNION ALL SELECT ${runSubject(byName)} FROM properties ${byName} WHERE ${nameWhere})`
    );
  }

  const alias = `p${ctx.params.length}`;
  let predicate = run(alias);
  if (node.operator === 'before' || node.operator === 'after') {
    if (node.value === undefined) {
      throw new UnsupportedConstraintError(
        `Property "${node.property}" ${node.operator}: missing date.`
      );
    }
    // Values are stored as canonical JSON text; json_extract unquotes strings,
    // and unixepoch() returns NULL (no match) for anything that isn't a date.
    // The 'subsec' modifier (SQLite ≥3.42) keeps fractional seconds so the
    // comparison matches the ms-precision bound from instant() exactly.
    ctx.params.push(instant(requireLiteral(node.value, node.property)));
    predicate +=
      ` AND EXISTS (SELECT 1 FROM vals v WHERE v.id = ${alias}.value_id` +
      ` AND unixepoch(json_extract(v.body, '$'), 'subsec') * 1000 ${node.operator === 'before' ? '<' : '>'} ?)`;
  } else if (isNumericOperator(node.operator)) {
    // json_type guards against CAST('abc') = 0.0 false-matching a bound.
    const numeric = `json_type(v.body, '$') IN ('integer', 'real') AND CAST(json_extract(v.body, '$') AS REAL)`;
    let compare: string;
    if (node.operator === 'range') {
      ctx.params.push(
        requireNumber(node.value, node.property),
        requireNumber(node.value2, node.property)
      );
      compare = `${numeric} BETWEEN ? AND ?`;
    } else {
      ctx.params.push(requireNumber(node.value, node.property));
      compare = `${numeric} ${NUMERIC_CMP[node.operator]} ?`;
    }
    predicate += ` AND EXISTS (SELECT 1 FROM vals v WHERE v.id = ${alias}.value_id AND ${compare})`;
  }

  return subjectIn(
    `${subject}.id`,
    `${alias}.cached_entity_id`,
    `FROM properties ${alias}`,
    predicate,
    (ctx.outerRefs ?? 0) !== outer
  );
}

// ---------------------------------------------------------------------------
// Lifecycle-facet leaves
// ---------------------------------------------------------------------------
//
// A date facet (`datePublished`) is not a property row — it is its object's
// agentless occurrence's time. So it routes to `actions`, matching the object
// and occurrence type, and constrains `[time_earliest, time_latest]`. A bare
// value overlaps (`:1862` == `@during(1862, 1863)`); the event-centric
// `type:PublishAction` reaches the same rows from the other side.

function compileLifecycleFacet(
  node: Extract<ConstraintNode, { type: 'property' | 'association' }>,
  subject: string,
  ctx: Ctx
): string {
  const facet = getLifecycleFacet(node.property)!;
  const alias = `lf${ctx.params.length}`;
  ctx.params.push(facet.occurrence);
  const conds = [`${alias}.cached_object_entity_id = ${subject}.id`, `${alias}.type = ?`];

  if (node.type === 'property' && node.operator === 'equals' && node.value !== undefined) {
    const range = parseDateRange(requireLiteral(node.value, node.property));
    if (!range) {
      throw new UnsupportedConstraintError(
        `Unparseable date value for lifecycle facet "${node.property}".`
      );
    }
    conds.push(occurrenceOverlaps(alias, range.lower, range.upper, ctx));
  } else if (
    node.type === 'property' &&
    (node.operator === 'before' || node.operator === 'after')
  ) {
    if (node.value === undefined) {
      throw new UnsupportedConstraintError(
        `Lifecycle facet "${node.property}" ${node.operator}: missing date.`
      );
    }
    ctx.params.push(instant(requireLiteral(node.value, node.property)));
    conds.push(`${alias}.occurred_at ${node.operator === 'before' ? '<' : '>'} ?`);
  } else if (node.type === 'property' && node.operator === 'range') {
    const lo = actionDateRange(node.value, node.property);
    const hi = actionDateRange(node.value2, node.property);
    conds.push(occurrenceOverlaps(alias, lo.lower, hi.upper, ctx));
  } else if (node.type === 'property' && isNumericOperator(node.operator)) {
    // Granularity-aware comparison on the occurrence, matching action time
    // fields: > is after the whole period, >= from its start.
    const range = actionDateRange(node.value, node.property);
    const bounds: Record<string, ['>' | '>=' | '<' | '<=', number]> = {
      gt: ['>', range.upper],
      gte: ['>=', range.lower],
      lt: ['<', range.lower],
      lte: ['<=', range.upper],
    };
    const bound = bounds[node.operator];
    ctx.params.push(bound[1]);
    conds.push(`${alias}.occurred_at ${bound[0]} ?`);
  } else if (node.type === 'property' && node.operator === 'exists') {
    // Any occurrence at all — no further condition.
  } else {
    throw new UnsupportedConstraintError(
      `"${node.property}" is a date facet — compare it: ${node.property}:1949, ${node.property}:>1950, ${node.property}:1900..1950.`
    );
  }

  if (node.temporal && node.temporal !== 'ever') {
    conds.push(occurrenceTemporal(alias, node.temporal, ctx));
  }
  return `EXISTS (SELECT 1 FROM actions ${alias} WHERE ${conds.join(' AND ')})`;
}

/** The occurrence's range `[time_earliest, time_latest]` overlaps `[lower, upper]`. */
function occurrenceOverlaps(alias: string, lower: number, upper: number, ctx: Ctx): string {
  const earliest = `${alias}.time_earliest`;
  const latest = `${alias}.time_latest`;
  // [earliest, latest] overlaps [lower, upper], a NULL bound open. Spelled as
  // four disjoint branches, by which bounds are NULL, so each can use an index;
  // a known earliest is the occurrence (`occurred_at`), so its bound rides that.
  ctx.params.push(lower, upper, upper, lower);
  return (
    `((${earliest} IS NULL AND ${latest} IS NULL)` +
    ` OR (${earliest} IS NULL AND ${latest} >= ?)` +
    ` OR (${alias}.occurred_at <= ? AND ${earliest} IS NOT NULL AND ${latest} IS NULL)` +
    ` OR (${alias}.occurred_at <= ? AND ${earliest} IS NOT NULL AND ${latest} >= ?))`
  );
}

/** Temporal modifier over an occurrence's time (a point/range, not a run interval). */
function occurrenceTemporal(alias: string, modifier: TemporalModifier, ctx: Ctx): string {
  const lo = `${alias}.time_earliest`;
  const hi = `${alias}.time_latest`;
  const at = `${alias}.occurred_at`;
  if (typeof modifier === 'object' && (isAtExpr(modifier) || 'atAnchor' in modifier)) {
    throw new UnsupportedConstraintError(
      `A row-pinned window (@t / while) is not supported over occurrence dates yet.`
    );
  }
  // `current`/`past`/`ever` describe an open/closed run; a point occurrence has
  // no such phase, so they add no constraint.
  if (typeof modifier === 'string') return '1=1';
  if ('at' in modifier) {
    const t = instant(modifier.at);
    ctx.params.push(t, t);
    return `(${lo} IS NULL OR ${lo} <= ?) AND (${hi} IS NULL OR ${hi} >= ?)`;
  }
  if ('during' in modifier) {
    const [start, end] = modifier.during;
    ctx.params.push(instant(end), instant(start));
    return `(${lo} IS NULL OR ${lo} <= ?) AND (${hi} IS NULL OR ${hi} >= ?)`;
  }
  if ('throughout' in modifier) {
    const [start, end] = modifier.throughout;
    ctx.params.push(instant(start), instant(end));
    return `${lo} >= ? AND ${hi} <= ?`;
  }
  if ('asof' in modifier) {
    // An occurrence carries no observed window; what was known by T is what
    // some source had asserted by T.
    ctx.params.push(instant(modifier.asof));
    return `${alias}.asserted_at < ?`;
  }
  if ('before' in modifier) {
    ctx.params.push(instant(modifier.before));
    return `${at} < ?`;
  }
  ctx.params.push(instant(modifier.after));
  return `${at} > ?`;
}

// ---------------------------------------------------------------------------
// Sourced identity leaves
// ---------------------------------------------------------------------------

// `source`/`sourceId`/`handle` are structural keys, not predicates — they are
// never shredded into `properties` (see fold/shred.ts STRUCTURAL_KEYS). All
// three are their own columns on `sourced_entities`. They carry identity, not
// temporal facts, so no temporal modifier applies (matching the action side,
// evaluate.ts compileActionNode).
const SOURCED_IDENTITY_COLUMNS: Record<string, string> = {
  source: 'se.source',
  sourceId: 'se.source_id',
  handle: 'se.handle',
};

function isSourcedIdentity(property: string): boolean {
  return property in SOURCED_IDENTITY_COLUMNS;
}

function compileSourced(
  node: Extract<ConstraintNode, { type: 'property' }>,
  subject: string,
  ctx: Ctx
): string {
  const col = SOURCED_IDENTITY_COLUMNS[node.property];
  let match: string;
  if (node.operator === 'exists') {
    match = `${col} IS NOT NULL`;
  } else if (node.operator === 'equals' && node.value !== undefined) {
    ctx.params.push(String(requireLiteral(node.value, node.property)));
    match = `${col} = ?`;
  } else {
    throw new UnsupportedConstraintError(
      `Operator "${node.operator}" is not supported on sourced identity "${node.property}".`
    );
  }
  return `EXISTS (SELECT 1 FROM sourced_entities se WHERE se.entity_id = ${subject}.id AND ${match})`;
}

/**
 * Quantitative predicate → metrics leaf. The value at T is the latest reading
 * with valid_at ≤ T (deterministic tiebreak: observed time, then value);
 * current/ever read the latest reading overall.
 */
function compileMetric(
  node: Extract<ConstraintNode, { type: 'property' }>,
  subject: string,
  ctx: Ctx
): string {
  const alias = `m${ctx.params.length}`;
  const pred = predicateExpr(node.property, ctx);
  let bound = '';
  const modifier = node.temporal;
  if (typeof modifier === 'object' && (isAtExpr(modifier) || 'atAnchor' in modifier)) {
    throw new UnsupportedConstraintError(
      `A row-pinned window (@t / while) is not supported on metric predicate "${node.property}".`
    );
  }
  if (modifier !== undefined && modifier !== 'current' && modifier !== 'ever') {
    if (modifier === 'past') {
      throw new UnsupportedConstraintError(
        `Temporal "past" is not meaningful for the metric predicate "${node.property}".`
      );
    } else if ('at' in modifier) {
      ctx.params.push(instant(modifier.at));
      bound = ` AND ${alias}.valid_at <= ?`;
    } else if ('before' in modifier) {
      ctx.params.push(instant(modifier.before));
      bound = ` AND ${alias}.valid_at < ?`;
    } else if ('during' in modifier) {
      ctx.params.push(instant(modifier.during[1]));
      bound = ` AND ${alias}.valid_at < ?`;
    } else if ('throughout' in modifier || 'asof' in modifier) {
      throw new UnsupportedConstraintError(
        `This temporal scope is not supported on metric predicate "${node.property}" yet.`
      );
    } else {
      ctx.params.push(instant(modifier.after));
      bound = ` AND ${alias}.valid_at > ?`;
    }
  }

  const series =
    `FROM metrics ${alias} WHERE ${alias}.cached_entity_id = ${subject}.id` +
    ` AND ${alias}.predicate = ${pred}${bound}`;

  if (node.operator === 'exists') {
    return `EXISTS (SELECT 1 ${series})`;
  }
  const latest =
    `(SELECT ${alias}.value ${series}` +
    ` ORDER BY ${alias}.valid_at DESC, ${alias}.observed_at DESC, ${alias}.value DESC LIMIT 1)`;
  if (node.operator === 'equals' && node.value !== undefined) {
    const literal = requireLiteral(node.value, node.property);
    const num = Number(literal);
    if (!Number.isFinite(num)) {
      throw new UnsupportedConstraintError(
        `Value "${literal}" is not a number (metric predicate "${node.property}").`
      );
    }
    ctx.params.push(num);
    return `${latest} = ?`;
  }
  if (isNumericOperator(node.operator)) {
    if (node.operator === 'range') {
      ctx.params.push(
        requireNumber(node.value, node.property),
        requireNumber(node.value2, node.property)
      );
      return `${latest} BETWEEN ? AND ?`;
    }
    ctx.params.push(requireNumber(node.value, node.property));
    return `${latest} ${NUMERIC_CMP[node.operator]} ?`;
  }
  throw new UnsupportedConstraintError(
    `Operator "${node.operator}" is not supported on metric predicate "${node.property}".`
  );
}

// ---------------------------------------------------------------------------
// Special properties (encountered / liked / consuming / completed)
// ---------------------------------------------------------------------------

/**
 * Probe the materialized agent-property runs: subject = the encountered/liked
 * object, nested constraints bind to the acting agent.
 */
function compileSpecial(
  property: string,
  temporal: TemporalModifier | undefined,
  constraints: ConstraintNode[],
  subject: string,
  ctx: Ctx,
  agentSelfId?: number
): string {
  const alias = `sp${ctx.params.length}`;
  const pred = predicateExpr(property, ctx);
  const temporalClause = compileTemporal(alias, temporal ?? 'current', ctx);

  let nested = '';
  if (agentSelfId !== undefined) {
    // `completed:@me` — scope the run to the self agent by identity, a direct FK
    // comparison rather than the cached_name EXISTS.
    ctx.params.push(agentSelfId);
    nested = ` AND ${alias}.cached_agent_entity_id = ?`;
  } else if (constraints.length > 0) {
    const agent = `${alias}_a`;
    const inner = constraints.map(c => compile(c, agent, ctx)).join(' AND ');
    nested = ` AND EXISTS (SELECT 1 FROM entities ${agent} WHERE ${agent}.id = ${alias}.cached_agent_entity_id AND ${inner})`;
  }

  return (
    `EXISTS (SELECT 1 FROM properties ${alias}` +
    ` WHERE ${alias}.cached_entity_id = ${subject}.id AND ${alias}.predicate = ${pred}` +
    ` AND ${temporalClause}${nested})`
  );
}

// ---------------------------------------------------------------------------
// Encounter predicate — the `encounters` event log, not a run
// ---------------------------------------------------------------------------

/**
 * Temporal filter for a point event (a single `cached_timestamp`), the
 * encounter-log analogue of {@link compileTemporal}. There is no validity
 * interval to open or close: existence ('ever'/'current') is unfiltered, and
 * `@at`/`@during`/`before`/`after` constrain the instant directly.
 */
function compileEncounterTemporal(p: string, modifier: TemporalModifier, ctx: Ctx): string {
  const t = `${p}.cached_timestamp`;
  if (typeof modifier === 'object' && (isAtExpr(modifier) || 'atAnchor' in modifier)) {
    throw new UnsupportedConstraintError(
      `A row-pinned window (@t / while) is not supported over the encounters log yet.`
    );
  }
  if (modifier === 'ever' || modifier === 'current' || modifier === 'past') return '1=1';
  if ('at' in modifier) {
    ctx.params.push(instant(modifier.at));
    return `${t} = ?`;
  }
  if ('during' in modifier) {
    const [start, end] = modifier.during;
    ctx.params.push(instant(start), instant(end));
    return `${t} >= ? AND ${t} < ?`;
  }
  if ('throughout' in modifier) {
    // A point event inside the window — containment and overlap coincide.
    const [start, end] = modifier.throughout;
    ctx.params.push(instant(start), instant(end));
    return `${t} >= ? AND ${t} < ?`;
  }
  if ('asof' in modifier) {
    throw new UnsupportedConstraintError(`asof() is not supported over the encounters log yet.`);
  }
  if ('before' in modifier) {
    ctx.params.push(instant(modifier.before));
    return `${t} < ?`;
  }
  // after
  ctx.params.push(instant(modifier.after));
  return `${t} > ?`;
}

/**
 * Reducers over the encounter log: `first(encountered):<2015` folds
 * the subject's encounter timestamps with MIN/MAX and compares the result with
 * the same granularity rounding as every other date — `<2015` is before the
 * year begins, `:2019` means the fold lands inside it. An entity with no
 * encounters aggregates to NULL and never matches.
 */
function compileEncounterReducer(
  node: Extract<ConstraintNode, { type: 'property' }>,
  subject: string,
  ctx: Ctx
): string {
  const def = getEncounterPredicate(node.property);
  if (def === undefined) {
    throw new UnsupportedConstraintError(
      `Reducers apply to the encounter log — first(encountered), last(interactedWith).`
    );
  }
  if (node.temporal !== undefined) {
    throw new UnsupportedConstraintError(
      `Temporal scopes on ${node.reduce}(${node.property}) are not supported yet.`
    );
  }
  const en = `er${ctx.params.length}`;
  ctx.params.push(def.level);
  const side = def.bidirectional
    ? `(${en}.cached_subject_entity_id = ${subject}.id OR ${en}.cached_encounterer_entity_id = ${subject}.id)`
    : `${en}.cached_subject_entity_id = ${subject}.id`;
  const agg =
    `(SELECT ${node.reduce === 'min' ? 'MIN' : 'MAX'}(${en}.cached_timestamp)` +
    ` FROM encounters ${en} WHERE ${en}.level = ? AND ${side})`;

  if (node.operator === 'equals') {
    const range = actionDateRange(node.value, node.property);
    ctx.params.push(range.lower, range.upper);
    return `${agg} BETWEEN ? AND ?`;
  }
  if (node.operator === 'range') {
    const lo = actionDateRange(node.value, node.property);
    const hi = actionDateRange(node.value2, node.property);
    ctx.params.push(lo.lower, hi.upper);
    return `${agg} BETWEEN ? AND ?`;
  }
  if (isNumericOperator(node.operator)) {
    const range = actionDateRange(node.value, node.property);
    const bounds: Record<string, ['>' | '>=' | '<' | '<=', number]> = {
      gt: ['>', range.upper],
      gte: ['>=', range.lower],
      lt: ['<', range.lower],
      lte: ['<=', range.upper],
    };
    const bound = bounds[node.operator];
    ctx.params.push(bound[1]);
    return `${agg} ${bound[0]} ?`;
  }
  throw new UnsupportedConstraintError(
    `Operator "${node.operator}" is not supported on ${node.reduce}(${node.property}).`
  );
}

/**
 * Probe the encounter log. The queried entity is the encounter's subject; a
 * directional predicate (`encountered`) binds the other party to `encounterer`,
 * while a bidirectional one (`interactedWith`) matches the entity on either
 * side — an exchange is symmetric — and binds the other party to whichever
 * column the entity is not. The `:@me`/`:"Alice"` constraint scopes that other
 * party.
 */
function compileEncounter(
  predicate: string,
  temporal: TemporalModifier | undefined,
  constraints: ConstraintNode[],
  subject: string,
  ctx: Ctx,
  otherSelfId?: number
): string {
  const def = getEncounterPredicate(predicate)!;
  const alias = `en${ctx.params.length}`;
  ctx.params.push(def.level);
  const levelClause = `${alias}.level = ?`;
  const temporalClause = compileEncounterTemporal(alias, temporal ?? 'ever', ctx);

  // A constraint on the party opposite the queried entity, against the given
  // column (`cached_encounterer_entity_id` when the entity is the subject, vice versa).
  const other = (col: string): string => {
    if (otherSelfId !== undefined) {
      ctx.params.push(otherSelfId);
      return `${col} = ?`;
    }
    if (constraints.length > 0) {
      const o = `${alias}_o${ctx.params.length}`;
      const inner = constraints.map(c => compile(c, o, ctx)).join(' AND ');
      return `EXISTS (SELECT 1 FROM entities ${o} WHERE ${o}.id = ${col} AND ${inner})`;
    }
    return '1=1';
  };

  const match = def.bidirectional
    ? `((${alias}.cached_subject_entity_id = ${subject}.id AND ${other(`${alias}.cached_encounterer_entity_id`)})` +
      ` OR (${alias}.cached_encounterer_entity_id = ${subject}.id AND ${other(`${alias}.cached_subject_entity_id`)}))`
    : `${alias}.cached_subject_entity_id = ${subject}.id AND ${other(`${alias}.cached_encounterer_entity_id`)}`;

  return (
    `EXISTS (SELECT 1 FROM encounters ${alias}` +
    ` WHERE ${levelClause} AND ${temporalClause} AND ${match})`
  );
}

// ---------------------------------------------------------------------------
// Aggregates / fulltext / associations
// ---------------------------------------------------------------------------

function compileFullText(value: string, subject: string, ctx: Ctx): string {
  const terms = ftsQuery(value);
  if (terms === '') return '1=0';
  ctx.params.push(terms);
  // IN (uncorrelated subquery): the FTS index runs the MATCH once and the
  // result set is probed per row — not one MATCH per candidate row.
  return `${subject}.id IN (SELECT rowid FROM entity_fts WHERE entity_fts MATCH ?)`;
}

/**
 * `~` similarity as id-list membership. As the page's sort key
 * (`ctx.rankText`) the full ranked list applies — membership is the page
 * window; as a predicate (nested, OR'd, counted) only the prefix above the
 * host's similarity threshold does. The ids come from our own vector index
 * (integers by construction), so they inline rather than spending
 * bound-parameter slots on a few hundred values.
 */
function compileSimilar(text: string, subject: string, ctx: Ctx): string {
  const resolution = ctx.similar?.get(text);
  if (resolution === undefined) {
    throw new UnsupportedConstraintError(
      `~"${text}" needs the semantic index: no similarity resolution was provided. ` +
        `Build the index and start the embedding service, or drop the ~ term.`
    );
  }
  const ids = ctx.rankText === text ? resolution.ids : resolution.ids.slice(0, resolution.cut);
  if (ids.length === 0) return '1=0';
  return `${subject}.id IN (${ids.map(Number).join(', ')})`;
}

/**
 * AND of phrase-quoted terms — injection-safe and forgiving (all terms must
 * appear, in any column). Matches current text only.
 */
function ftsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => `"${t.replaceAll('"', '""')}"`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Virtual inverse edges
// ---------------------------------------------------------------------------
//
// Declared in the ontology (:inverseName on the forward property), never
// stored: the compiler walks the forward edge backwards — `authorOf:{…}` probes
// properties with the SUBJECT on the value side.

function compileInverseProperty(
  node: Extract<ConstraintNode, { type: 'property' }>,
  subject: string,
  ctx: Ctx
): string {
  const def = getInverseEdge(node.property)!;
  if (node.temporal !== undefined) {
    throw new UnsupportedConstraintError(
      `Temporal modifiers on inverse edge "${node.property}" are not supported yet.`
    );
  }
  if (isAnchorValue(node.value)) {
    return compileInverseEdge(def, [], subject, ctx, requireSelf(ctx));
  }
  if (node.operator === 'equals' && node.value !== undefined) {
    return compileInverseEdge(
      def,
      [{ type: 'property', property: 'name', operator: 'equals', value: node.value }],
      subject,
      ctx
    );
  }
  if (node.operator === 'exists') {
    return compileInverseEdge(def, [], subject, ctx);
  }
  throw new UnsupportedConstraintError(
    `Operator "${node.operator}" is not supported on inverse edge "${node.property}".`
  );
}

function compileInverseAssociation(
  node: Extract<ConstraintNode, { type: 'association' }>,
  subject: string,
  ctx: Ctx
): string {
  const def = getInverseEdge(node.property)!;
  if (node.temporal !== undefined) {
    throw new UnsupportedConstraintError(
      `Temporal modifiers on inverse edge "${node.property}" are not supported yet.`
    );
  }
  if (node.cardinality !== undefined) {
    throw new UnsupportedConstraintError(
      `Cardinality over inverse edge "${node.property}" is not supported yet.`
    );
  }
  return compileInverseEdge(def, node.constraints, subject, ctx);
}

function compileInverseEdge(
  def: InverseEdgeDef,
  constraints: ConstraintNode[],
  subject: string,
  ctx: Ctx,
  selfId?: number
): string {
  const alias = `inv${ctx.params.length}`;
  ctx.params.push(def.forward);
  const temporal = compileTemporal(alias, 'current', ctx);
  const clause =
    `${alias}.cached_object_entity_id = ${subject}.id AND ${alias}.predicate = ?` +
    ` AND ${alias}.agent_sourced_id IS NULL AND ${temporal}`;
  if (selfId !== undefined) {
    ctx.params.push(selfId);
    return `EXISTS (SELECT 1 FROM properties ${alias} WHERE ${clause} AND ${alias}.cached_entity_id = ?)`;
  }
  const holder = `${alias}_h`;
  const nested = constraints.map(c => compile(c, holder, ctx)).join(' AND ');
  return (
    `EXISTS (SELECT 1 FROM properties ${alias}` +
    ` JOIN entities ${holder} ON ${holder}.id = ${alias}.cached_entity_id` +
    ` WHERE ${clause}${nested === '' ? '' : ` AND ${nested}`})`
  );
}

function compileAssociation(
  node: Extract<ConstraintNode, { type: 'association' }>,
  subject: string,
  ctx: Ctx
): string {
  // Params are positional, so every probe rebuilds its own pred/temporal/nested
  // clause set — 'every' emits two probes and must push each set twice.
  const probe = (nested: 'match' | 'miss' | 'any'): string => {
    const alias = `a${ctx.params.length}`;
    const target = `${alias}_e`;
    const pred = predicateExpr(node.property, ctx);
    const temporal = compileTemporal(alias, node.temporal ?? 'current', ctx);
    const inner =
      nested === 'any' ? '' : node.constraints.map(c => compile(c, target, ctx)).join(' AND ');
    const innerClause = inner === '' ? '' : ` AND ${nested === 'miss' ? `NOT (${inner})` : inner}`;
    return (
      `FROM properties ${alias}` +
      ` LEFT JOIN location_values ${alias}_lv ON ${alias}_lv.id = ${alias}.value_location_id` +
      ` JOIN entities ${target} ON ${target}.id = COALESCE(${alias}.cached_object_entity_id, ${alias}_lv.cached_entity_id)` +
      ` WHERE ${alias}.cached_entity_id = ${subject}.id AND ${alias}.predicate = ${pred}` +
      ` AND ${alias}.agent_sourced_id IS NULL AND ${temporal}${innerClause}`
    );
  };

  const card = node.cardinality;
  if (card === 'every') {
    // Non-vacuous: at least one neighbor, and no neighbor missing the match.
    return `(EXISTS (SELECT 1 ${probe('any')}) AND NOT EXISTS (SELECT 1 ${probe('miss')}))`;
  }
  // The neighbor is the run's entity value, or the place its location value
  // links to (the probe's COALESCE), as two branches so each can start from
  // the neighbor's side through an index.
  const outer = ctx.outerRefs ?? 0;
  const branch = (via: 'entity' | 'location') => {
    const alias = `a${ctx.params.length}`;
    const target = `${alias}_e`;
    const pred = predicateExpr(node.property, ctx);
    const temporal = compileTemporal(alias, node.temporal ?? 'current', ctx);
    const inner = node.constraints.map(c => compile(c, target, ctx)).join(' AND ');
    const from =
      via === 'entity'
        ? `FROM properties ${alias} JOIN entities ${target} ON ${target}.id = ${alias}.cached_object_entity_id`
        : `FROM properties ${alias}` +
          ` JOIN location_values ${alias}_lv ON ${alias}_lv.id = ${alias}.value_location_id` +
          ` JOIN entities ${target} ON ${target}.id = ${alias}_lv.cached_entity_id`;
    const where =
      (via === 'location'
        ? `${alias}.cached_object_entity_id IS NULL AND ${alias}.value_location_id IS NOT NULL AND `
        : '') +
      `${alias}.predicate = ${pred} AND ${alias}.agent_sourced_id IS NULL AND ${temporal}` +
      (inner === '' ? '' : ` AND ${inner}`);
    return { alias, from, where };
  };
  const entity = branch('entity');
  const location = branch('location');
  const correlated = (ctx.outerRefs ?? 0) !== outer;
  if (card !== undefined) {
    ctx.params.push(card.n);
    if (correlated) {
      const count = (b: { alias: string; from: string; where: string }) =>
        `(SELECT COUNT(*) ${b.from} WHERE ${runSubject(b.alias)} = ${subject}.id AND ${b.where})`;
      return `(${count(entity)} + ${count(location)}) ${card.cmp} ?`;
    }
    const groups =
      `SELECT id FROM (SELECT ${runSubject(entity.alias)} AS id ${entity.from} WHERE ${entity.where}` +
      ` UNION ALL SELECT ${runSubject(location.alias)} AS id ${location.from} WHERE ${location.where}) GROUP BY id`;
    return countIn(`${subject}.id`, groups, card);
  }
  return correlated
    ? `(${subjectIn(`${subject}.id`, runSubject(entity.alias), entity.from, entity.where, true)}` +
        ` OR ${subjectIn(`${subject}.id`, runSubject(location.alias), location.from, location.where, true)})`
    : `${subject}.id IN (SELECT ${runSubject(entity.alias)} ${entity.from} WHERE ${entity.where}` +
        ` UNION ALL SELECT ${runSubject(location.alias)} ${location.from} WHERE ${location.where})`;
}

function instant(value: string): number {
  const t = parseInstant(value);
  if (t === undefined) {
    throw new UnsupportedConstraintError(`Unparseable date in query: "${value}"`);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Action-target queries
// ---------------------------------------------------------------------------

const ACTION_ROLE_COLUMNS: Record<string, string> = {
  agent: 'cached_agent_entity_id',
  object: 'cached_object_entity_id',
  // location is a location value (FK to location_values), not an entity role —
  // location-as-named-place queries traverse the value's up-link, added later.
  result: 'cached_result_entity_id',
  instrument: 'cached_instrument_entity_id',
  target: 'cached_target_entity_id',
};

const ACTION_TIME_COLUMNS: Record<string, string> = {
  // `timestamp` is when the action OCCURRED, not when it was sighted — so
  // "read during:2019" matches a 2019 read even if imported from a 2024 export.
  timestamp: 'occurred_at',
  startTime: 'start_time',
  endTime: 'end_time',
};

// ---------------------------------------------------------------------------
// Counting: probe cheaply, then fetch — `--count` and
// `--count-by` answer "how much is there" without moving data.
// ---------------------------------------------------------------------------

/**
 * A compiled restriction: the WHERE clause over the root alias (`e` for
 * entities, `a` for actions) and its positional params. The summary layer
 * (`summary.ts`) builds its own SELECTs over these — facets, the census, the
 * span — so every aggregate reads exactly the set the page reads.
 */
export interface CompiledWhere {
  where: string;
  params: unknown[];
  /** The ego's entity id, or `null` when the store has no self hub. */
  selfId: number | null;
}

export function compileEntityWhere(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { similar?: SimilarResolutions } = {}
): CompiledWhere {
  const ctx: Ctx = { params: [], sqlite, similar: options.similar };
  const where = ast.length > 0 ? ast.map(node => compile(node, 'e', ctx)).join(' AND ') : '1=1';
  const self = resolveSelf(ctx);
  return { where, params: ctx.params, selfId: self === NO_SELF_MATCH ? null : self };
}

/**
 * The feed window as a restriction: an action is in `[from, to)` when its
 * `[occurred_at, latest edge]` interval overlaps it. The page, the count, the
 * summary, and every facet append the same clause, so a windowed query's
 * aggregates describe exactly the rows its page draws from.
 */
function appendWindow(where: string, ctx: Ctx, options: { from?: number; to?: number }): string {
  let out = where;
  if (options.to !== undefined) {
    out += ' AND a.occurred_at < ?';
    ctx.params.push(options.to);
  }
  if (options.from !== undefined) {
    out += ' AND COALESCE(a.end_time, a.occurred_at) >= ?';
    ctx.params.push(options.from);
  }
  return out;
}

export function compileActionWhere(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { similar?: SimilarResolutions; from?: number; to?: number } = {}
): CompiledWhere {
  const ctx: Ctx = { params: [], sqlite, similar: options.similar };
  const where = appendWindow(
    ['1=1', ...ast.map(node => compileActionNode(node, ctx))].join(' AND '),
    ctx,
    options
  );
  const self = resolveSelf(ctx);
  return { where, params: ctx.params, selfId: self === NO_SELF_MATCH ? null : self };
}

export function countEntities(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { similar?: SimilarResolutions } = {}
): number {
  const { where, params } = compileEntityWhere(sqlite, ast, options);
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM entities e WHERE ${where}`)
    .get(...params) as { c: number };
  return row.c;
}

export function countActions(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { similar?: SimilarResolutions; from?: number; to?: number } = {}
): number {
  const { where, params } = compileActionWhere(sqlite, ast, options);
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS c FROM actions a WHERE ${where}`)
    .get(...params) as { c: number };
  return row.c;
}

export interface ActionQueryOptions {
  /** Reference instant for `current` / `past` in nested constraints. */
  at?: number;
  limit?: number;
  /**
   * Keyset cursor: `<sortInstant>|<actionId>`, walking the feed frontier
   * downward. `sortInstant` is the action's ordering key —
   * `COALESCE(end_time, occurred_at)`, an action's latest relevant edge.
   */
  cursor?: string;
  /**
   * Window lower bound (epoch ms), interval-intersection: an action is in the
   * window when its `[occurred_at, sortInstant]` interval overlaps `[from, to)`.
   * `from` bounds the latest edge (`COALESCE(end_time, occurred_at) >= from`),
   * so a span that started before the window but ends inside it still matches.
   */
  from?: number;
  /**
   * Window upper bound (epoch ms), exclusive on `occurred_at` (an action's
   * start): `occurred_at < to`. See {@link ActionQueryOptions.from}.
   */
  to?: number;
  /** Resolutions for `~` constraints nested in role traversals. */
  similar?: SimilarResolutions;
}

/** A bucket granularity for the activity histogram. */
export type HistogramBucket = 'day' | 'month' | 'year';

/** One histogram bin: the bucket's start instant (epoch ms) and its action count. */
export interface HistogramBin {
  start: number;
  count: number;
}

/** Append the optional `from`/`to` occurred-at bounds to a compiled WHERE. */
function appendDateBounds(
  where: string,
  ctx: Ctx,
  options: { from?: number; to?: number }
): string {
  if (options.from !== undefined) {
    where += ' AND a.occurred_at >= ?';
    ctx.params.push(options.from);
  }
  if (options.to !== undefined) {
    where += ' AND a.occurred_at < ?';
    ctx.params.push(options.to);
  }
  return where;
}

export interface ActionQueryPage {
  ids: number[];
  hasMore: boolean;
  nextCursor?: string;
}

export function queryActionIds(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: ActionQueryOptions = {}
): number[] {
  return queryActionPage(sqlite, ast, options).ids;
}

/**
 * Evaluate a CQL AST against actions, one row per action, newest first by
 * `sortInstant = COALESCE(end_time, occurred_at)` — an action's latest relevant
 * edge — then id (both descending), keyset-paginated on `<sortInstant>|<id>`.
 * A point action or an open span falls back to its occurrence; a closed span
 * sorts at its end. Ordering on the latest edge keeps the timeline coherent:
 * sweeping the feed frontier downward, an action is delivered exactly when its
 * newest edge first becomes visible, and its start edge (always <= sortInstant)
 * is already client-side by then — so a client that splits a durated action into
 * start/end timeline rows does so gap-free under pagination.
 *
 * The window is an interval intersection: an action matches when its
 * `[occurred_at, sortInstant]` interval overlaps `[from, to)`
 * (`occurred_at < to AND COALESCE(end_time, occurred_at) >= from`), so a span
 * that straddles a window boundary is caught from the side it crosses. A 2019
 * read imported from a 2024 export still sorts in 2019, not at the crawl. Role
 * constraints recurse into the entity compiler against the cached role
 * entity-id columns.
 */
export function queryActionPage(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: ActionQueryOptions = {}
): ActionQueryPage {
  const ctx: Ctx = { params: [], sqlite, similar: options.similar };
  // An action's ordering key and window-top: its latest relevant edge.
  const sortInstant = 'COALESCE(a.end_time, a.occurred_at)';
  // Interval intersection: [occurred_at, sortInstant] overlaps [from, to).
  let where = appendWindow(
    ['1=1', ...ast.map(node => compileActionNode(node, ctx))].join(' AND '),
    ctx,
    options
  );
  if (options.cursor !== undefined) {
    const match = /^(-?\d+)\|(\d+)$/.exec(options.cursor);
    if (!match) {
      throw new UnsupportedConstraintError(`Invalid cursor: "${options.cursor}"`);
    }
    const ts = Number(match[1]);
    const id = Number(match[2]);
    ctx.params.push(ts, ts, id);
    where += ` AND (${sortInstant} < ? OR (${sortInstant} = ? AND a.id < ?))`;
  }
  const limit = options.limit ?? 100;
  const sql =
    `SELECT a.id AS id, ${sortInstant} AS sortInstant FROM actions a` +
    ` WHERE ${where} ORDER BY ${sortInstant} DESC, a.id DESC LIMIT ${Number(limit) + 1}`;
  const rows = sqlite.prepare(sql).all(...ctx.params) as Array<{
    id: number;
    sortInstant: number;
  }>;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    ids: page.map(r => r.id),
    hasMore,
    ...(hasMore && last ? { nextCursor: `${last.sortInstant}|${last.id}` } : {}),
  };
}

/**
 * Activity histogram: action counts bucketed by `occurred_at`, filtered by the
 * same AST as the feed (so the minimap reflects the active source/type/search).
 * Buckets are UTC; `start` is each bucket's start instant (epoch ms), newest
 * first. Drives a table-of-contents style timeline minimap.
 */
export function actionHistogram(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { bucket?: HistogramBucket; from?: number; to?: number } = {}
): HistogramBin[] {
  const ctx: Ctx = { params: [], sqlite };
  let where = ['1=1', ...ast.map(node => compileActionNode(node, ctx))].join(' AND ');
  where = appendDateBounds(where, ctx, options);
  // bucket is a controlled enum, so the format string is safe to inline.
  const fmt =
    options.bucket === 'day' ? '%Y-%m-%d' : options.bucket === 'year' ? '%Y-01-01' : '%Y-%m-01';
  const startMs = `CAST(strftime('%s', strftime('${fmt}', a.occurred_at / 1000.0, 'unixepoch')) AS INTEGER) * 1000`;
  const sql =
    `SELECT ${startMs} AS start, COUNT(*) AS count FROM actions a` +
    ` WHERE ${where} GROUP BY start ORDER BY start DESC`;
  return sqlite.prepare(sql).all(...ctx.params) as HistogramBin[];
}

/**
 * Encounters-over-time histogram for one entity: counts of encounters touching
 * it on either side (subject or encounterer), bucketed by `cached_timestamp`,
 * oldest first (chronological, for a left-to-right chart). The entity-page
 * analogue of {@link actionHistogram}, straight off the encounter log.
 */
export function encounterHistogram(
  sqlite: SqliteDriver,
  entityId: number,
  options: { bucket?: HistogramBucket } = {}
): HistogramBin[] {
  // bucket is a controlled enum, so the format string is safe to inline.
  const fmt =
    options.bucket === 'day' ? '%Y-%m-%d' : options.bucket === 'year' ? '%Y-01-01' : '%Y-%m-01';
  const startMs = `CAST(strftime('%s', strftime('${fmt}', en.cached_timestamp / 1000.0, 'unixepoch')) AS INTEGER) * 1000`;
  const sql =
    `SELECT ${startMs} AS start, COUNT(*) AS count FROM encounters en` +
    ` WHERE en.cached_subject_entity_id = ? OR en.cached_encounterer_entity_id = ?` +
    ` GROUP BY start ORDER BY start ASC`;
  return sqlite.prepare(sql).all(entityId, entityId) as HistogramBin[];
}

/**
 * Occurrence-time predicates on action queries: a partial date IS
 * an interval — equality means overlap, and comparators round by granularity
 * (`timestamp:>2019` is after the whole year; `>=2019` from its start).
 * `timestamp` reads the occurrence range; `startTime`/`endTime` compare their
 * own columns.
 */
const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

function durationMs(value: ConstraintValue | undefined, property: string): number {
  const raw = requireLiteral(
    value ??
      (() => {
        throw new UnsupportedConstraintError(`"${property}" needs a duration: ${property}:>=30m.`);
      })(),
    property
  );
  const m = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(raw);
  if (m === null) {
    throw new UnsupportedConstraintError(
      `"${raw}" is not a duration for ${property} — use 45s, 30m, 12h, 3d, 2w.`
    );
  }
  return Number(m[1]) * DURATION_UNITS[m[2]];
}

/**
 * `duration:` on an action root — how long the occurrence lasted, its end minus
 * its start; a point action lasts nothing. Compares (`>=`, `<`, …), ranges
 * (`30m..2h`), equals (to the minute is rarely meant — use a range), and
 * existence (`duration:*` — the action has a span at all).
 */
function compileDuration(
  node: Extract<ConstraintNode, { type: 'property' }>,
  ctx: Ctx,
  alias: string
): string {
  const span = `(COALESCE(${alias}.end_time, ${alias}.occurred_at) - ${alias}.occurred_at)`;
  if (node.operator === 'exists') return `${alias}.end_time IS NOT NULL`;
  if (node.operator === 'range') {
    ctx.params.push(durationMs(node.value, 'duration'), durationMs(node.value2, 'duration'));
    return `${span} BETWEEN ? AND ?`;
  }
  const cmp =
    node.operator === 'equals' ? '=' : NUMERIC_CMP[node.operator as keyof typeof NUMERIC_CMP];
  if (cmp === undefined) {
    throw new UnsupportedConstraintError(
      `Operator "${node.operator}" is not supported on duration — compare it (duration:>=30m) or range it (duration:30m..2h).`
    );
  }
  ctx.params.push(durationMs(node.value, 'duration'));
  return `${span} ${cmp} ?`;
}

function compileActionTime(
  node: Extract<ConstraintNode, { type: 'property' }>,
  timeCol: string,
  ctx: Ctx,
  alias = 'a'
): string {
  const col = `${alias}.${timeCol}`;
  if (node.operator === 'exists') return `${col} IS NOT NULL`;
  if (node.operator === 'before' || node.operator === 'after') {
    ctx.params.push(instant(requireLiteral(actionTimeValue(node), node.property)));
    return `${col} ${node.operator === 'before' ? '<' : '>'} ?`;
  }
  const range = actionDateRange(node.value, node.property);
  if (node.operator === 'equals' || node.operator === 'range') {
    const upper =
      node.operator === 'range' ? actionDateRange(node.value2, node.property).upper : range.upper;
    if (node.property === 'timestamp') return occurrenceOverlaps(alias, range.lower, upper, ctx);
    ctx.params.push(range.lower, upper);
    return `${col} BETWEEN ? AND ?`;
  }
  const bounds: Partial<Record<string, ['>' | '>=' | '<' | '<=', number]>> = {
    gt: ['>', range.upper],
    gte: ['>=', range.lower],
    lt: ['<', range.lower],
    lte: ['<=', range.upper],
  };
  const bound = bounds[node.operator];
  if (bound === undefined) {
    throw new UnsupportedConstraintError(
      `Operator "${node.operator}" is not supported on action time field "${node.property}".`
    );
  }
  ctx.params.push(bound[1]);
  return `${col} ${bound[0]} ?`;
}

function actionTimeValue(node: Extract<ConstraintNode, { type: 'property' }>): ConstraintValue {
  if (node.value === undefined) {
    throw new UnsupportedConstraintError(`"${node.property}" is missing its date.`);
  }
  return node.value;
}

function actionDateRange(value: ConstraintValue | undefined, property: string): DateRange {
  if (value === undefined) {
    throw new UnsupportedConstraintError(`"${property}" is missing its date.`);
  }
  const literal = requireLiteral(value, property);
  const range = parseDateRange(literal);
  if (range === undefined) {
    throw new UnsupportedConstraintError(
      `"${literal}" is not a date for "${property}" — relative dates (today, -7d) are not supported here yet.`
    );
  }
  return range;
}

// ---------------------------------------------------------------------------
// Temporal-relational pseudo-edges
// ---------------------------------------------------------------------------

/** Resolve `@t` (this row's event time) to the enclosing action's occurrence. */
function substituteAtAnchor(node: ConstraintNode, expr: string): ConstraintNode {
  switch (node.type) {
    case 'property':
    case 'association': {
      const pinned =
        node.temporal !== undefined &&
        typeof node.temporal === 'object' &&
        'atAnchor' in node.temporal
          ? { ...node, temporal: { atExpr: expr } as unknown as TemporalModifier }
          : node;
      if (pinned.type === 'association') {
        return { ...pinned, constraints: pinned.constraints.map(c => substituteAtAnchor(c, expr)) };
      }
      return pinned;
    }
    case 'and':
    case 'or':
      return { ...node, constraints: node.constraints.map(c => substituteAtAnchor(c, expr)) };
    default:
      return node;
  }
}

// Multi-valued role edges: recipient/attendee/with have no
// single-FK slot; they probe action_role_edges, and cardinality counts rows
// there. The same probe serves some/none/every/count.
const ACTION_EDGE_ROLES: ReadonlySet<string> = new Set(['recipient', 'attendee', 'with']);

function compileRoleEdges(
  node: Extract<ConstraintNode, { type: 'association' }>,
  ctx: Ctx,
  alias: string
): string {
  const probe = (nested: 'match' | 'miss' | 'any'): string => {
    const re = `re${ctx.params.length}`;
    const target = `${re}_e`;
    ctx.params.push(node.property);
    const inner =
      nested === 'any'
        ? ''
        : node.constraints
            .map(c => compile(substituteAtAnchor(c, `${alias}.occurred_at`), target, ctx))
            .join(' AND ');
    const innerClause = inner === '' ? '' : ` AND ${nested === 'miss' ? `NOT (${inner})` : inner}`;
    return (
      `FROM action_role_edges ${re}` +
      ` JOIN entities ${target} ON ${target}.id = ${re}.cached_entity_id` +
      ` WHERE ${re}.action_id = ${alias}.id AND ${re}.role = ?${innerClause}`
    );
  };
  const card = node.cardinality;
  if (card === 'every') {
    return `(EXISTS (SELECT 1 ${probe('any')}) AND NOT EXISTS (SELECT 1 ${probe('miss')}))`;
  }
  const re = `re${ctx.params.length}`;
  const target = `${re}_e`;
  const outer = ctx.outerRefs ?? 0;
  ctx.params.push(node.property);
  const inner = node.constraints
    .map(c => compile(substituteAtAnchor(c, `${alias}.occurred_at`), target, ctx))
    .join(' AND ');
  const from = `FROM action_role_edges ${re} JOIN entities ${target} ON ${target}.id = ${re}.cached_entity_id`;
  const where = `${re}.role = ?${inner === '' ? '' : ` AND ${inner}`}`;
  const correlated = (ctx.outerRefs ?? 0) !== outer;
  if (card !== undefined) {
    ctx.params.push(card.n);
    return correlated
      ? `(SELECT COUNT(*) ${from} WHERE ${re}.action_id = ${alias}.id AND ${where}) ${card.cmp} ?`
      : countIn(
          `${alias}.id`,
          `SELECT ${re}.action_id ${from} WHERE ${where} GROUP BY ${re}.action_id`,
          card
        );
  }
  return subjectIn(`${alias}.id`, `${re}.action_id`, from, where, correlated);
}

/**
 * `with:{…}` co-occurrence over the encounters log: entities whose
 * encounters land near an anchor entity's encounters. With no window, "near"
 * means the SAME originating action (co-participation in one event); a window
 * (`with(1d):{…}`) matches encounters within that distance in time. The anchor
 * itself is excluded — the question is who ELSE was around.
 */
function compileCoOccurrence(
  anchor: ConstraintNode[],
  gapMs: number | [number, number] | undefined,
  temporal: TemporalModifier | undefined,
  subject: string,
  ctx: Ctx,
  selfId?: number
): string {
  if (temporal !== undefined) {
    throw new UnsupportedConstraintError(
      `Temporal scopes on with:{…} are not supported yet — window the encounters with with(<gap>) instead.`
    );
  }
  if (anchor.length === 0 && selfId === undefined) {
    throw new UnsupportedConstraintError(
      `with:{ } needs an anchor — with:{ name:"…" }, with:{ id:"…" }, or with:@me.`
    );
  }
  const co = `co${ctx.params.length}`;
  const mine = `${co}_m`;
  const theirs = `${co}_t`;
  // Params are positional: the join window's placeholders precede the anchor
  // sub-select's in the SQL text, so push the gap first.
  let joinCond: string;
  if (gapMs === undefined) {
    joinCond = `${mine}.originating_action_id = ${theirs}.originating_action_id`;
  } else if (typeof gapMs === 'number') {
    // Range-bounded, not ABS(): keeps the encounters indexes' timestamp
    // column sargable (ABS() forces a full scan of the anchor's rows per
    // candidate encounter — benchmarked ~5000× slower).
    ctx.params.push(gapMs, gapMs);
    joinCond =
      `${theirs}.cached_timestamp > ${mine}.cached_timestamp - ?` +
      ` AND ${theirs}.cached_timestamp < ${mine}.cached_timestamp + ?`;
  } else {
    ctx.params.push(gapMs[1], gapMs[1], gapMs[0]);
    joinCond =
      `${theirs}.cached_timestamp >= ${mine}.cached_timestamp - ?` +
      ` AND ${theirs}.cached_timestamp <= ${mine}.cached_timestamp + ?` +
      ` AND ABS(${mine}.cached_timestamp - ${theirs}.cached_timestamp) >= ?`;
  }
  let anchorCond: string;
  if (selfId === undefined) {
    const anc = `${co}_a`;
    const conds = anchor.map(c => compile(c, anc, ctx)).join(' AND ');
    anchorCond = `${theirs}.cached_subject_entity_id IN (SELECT ${anc}.id FROM entities ${anc} WHERE ${conds})`;
  } else {
    ctx.params.push(selfId);
    anchorCond = `${theirs}.cached_subject_entity_id = ?`;
  }
  return (
    `EXISTS (SELECT 1 FROM encounters ${mine}` +
    ` JOIN encounters ${theirs} ON ${joinCond}` +
    ` WHERE ${mine}.cached_subject_entity_id = ${subject}.id` +
    ` AND ${anchorCond}` +
    ` AND ${mine}.cached_subject_entity_id != ${theirs}.cached_subject_entity_id)`
  );
}

/**
 * `while:{…}`: the row's agent satisfies the anchor's validity constraints AT
 * the row's own occurrence — every run probe in the body is pinned to the
 * correlated row time (the per-row temporal join, without the self-join).
 */
function compileWhile(
  node: Extract<ConstraintNode, { type: 'pseudoEdge' }>,
  agentCol: string,
  rootTime: string,
  ctx: Ctx
): string {
  const ag = `wh${ctx.params.length}`;
  const pinned = node.anchor.map(c => compile(pinAt(c, rootTime), ag, ctx)).join(' AND ');
  return `EXISTS (SELECT 1 FROM entities ${ag} WHERE ${ag}.id = ${agentCol}${pinned === '' ? '' : ` AND ${pinned}`})`;
}

/**
 * Event pseudo-edges: the root's own span against the anchor action set's span —
 * `after`/`since` measure from the anchor's end to the root's start,
 * `before`/`until` from the root's end to the anchor's start, `near` the
 * distance between the two intervals (zero when they overlap), and `while`
 * with an action anchor is overlap itself: the root happened during the anchor
 * — a message inside a visit's stay — or, read the other way round, a visit
 * that contains the message. `rootEnd` is the root's latest edge (its own
 * occurrence when it has no span), so a durated root is an interval on both
 * sides of the relation.
 */
/** A polynomial hash of a string, as base-36 — names a materialized anchor table. */
function shortHash(text: string): string {
  const modulus = 4_294_967_296;
  let h = 7;
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % modulus;
  return h.toString(36);
}

/** The anchor tables a connection holds, oldest first — bounded, so a
 *  long-lived read-API connection never accumulates them. */
const anchorTables = new WeakMap<SqliteDriver, string[]>();
const ANCHOR_TABLE_CAP = 16;

interface MaterializedAnchor {
  /** The temp table: `id`, `s` (start), `e` (end), indexed on `s`. */
  table: string;
  /** The longest span among the anchors, so an interval scan can be bounded
   *  from below on `s` and still catch every anchor that reaches the root. */
  maxSpan: number;
}

/**
 * Materialize a pseudo-edge's anchor set once: the anchor sub-query never
 * references the root, so it is evaluated a single time into an indexed temp
 * table instead of being re-run — text match and all — inside a correlated
 * EXISTS for every root row. The table is rebuilt on each compile (the store
 * may have changed) and named by the anchor's SQL, so the count, page, and
 * summary of one request rebuild the same table rather than piling up new
 * ones; a connection keeps at most {@link ANCHOR_TABLE_CAP}.
 */
function materializeAnchor(ctx: Ctx, anchor: ConstraintNode[]): MaterializedAnchor {
  const sub: Ctx = { params: [], sqlite: ctx.sqlite, similar: ctx.similar, selfId: ctx.selfId };
  const cond = anchor.map(c => compileActionNode(c, sub, 'anc')).join(' AND ');
  ctx.selfId = sub.selfId;
  const where = cond === '' ? '1=1' : cond;
  const name = `pe_${shortHash(`${where}|${JSON.stringify(sub.params)}`)}`;
  const { sqlite } = ctx;
  sqlite.exec(`DROP TABLE IF EXISTS temp.${name}`);
  sqlite
    .prepare(
      `CREATE TEMP TABLE ${name} AS SELECT anc.id AS id, anc.occurred_at AS s, COALESCE(anc.end_time, anc.occurred_at) AS e FROM actions anc WHERE ${where}`
    )
    .run(...sub.params);
  sqlite.exec(`CREATE INDEX temp.${name}_s ON ${name}(s)`);
  const row = sqlite.prepare(`SELECT COALESCE(MAX(e - s), 0) AS span FROM temp.${name}`).get() as {
    span: number;
  };
  const held = anchorTables.get(sqlite) ?? [];
  const kept = held.filter(t => t !== name);
  kept.push(name);
  while (kept.length > ANCHOR_TABLE_CAP) {
    const old = kept.shift();
    if (old !== undefined) sqlite.exec(`DROP TABLE IF EXISTS temp.${old}`);
  }
  anchorTables.set(sqlite, kept);
  return { table: `temp.${name}`, maxSpan: row.span };
}

/**
 * Event pseudo-edges: the root's own span against the anchor action set's span —
 * `after`/`since` measure from the anchor's end to the root's start,
 * `before`/`until` from the root's end to the anchor's start, `near` the
 * distance between the two intervals (zero when they overlap), and `while`
 * with an action anchor is overlap itself: the root happened during the anchor
 * — a message inside a visit's stay — or, read the other way round, a visit
 * that contains the message. `rootEnd` is the root's latest edge (its own
 * occurrence when it has no span), so a durated root is an interval on both
 * sides of the relation. The anchor set is materialized once (see
 * {@link materializeAnchor}) and every form bounds its scan of it on the
 * indexed start, using the anchors' longest span as the reach.
 */
function compilePseudoEvent(
  node: Extract<ConstraintNode, { type: 'pseudoEdge' }>,
  rootTime: string,
  ctx: Ctx,
  rootEnd = rootTime,
  rootAlias?: string
): string {
  if (node.gapMs === undefined && node.edge === 'near') {
    throw new UnsupportedConstraintError(`near needs a window: near(3d):{ … }.`);
  }
  const { table, maxSpan } = materializeAnchor(ctx, node.anchor);
  const t = `pe${ctx.params.length}`;
  const self = rootAlias === undefined ? '' : ` AND ${t}.id != ${rootAlias}.id`;
  const exists = (where: string): string =>
    `EXISTS (SELECT 1 FROM ${table} ${t} WHERE ${where}${self})`;
  // Every scan starts at the earliest anchor that can still reach the root:
  // one longest-span before the root's start, less any window.
  const reach = (window: number): string => {
    ctx.params.push(maxSpan + window);
    return `${t}.s >= ${rootTime} - ?`;
  };

  if (node.edge === 'while') {
    return exists(`${reach(0)} AND ${t}.s <= ${rootEnd} AND ${t}.e >= ${rootTime}`);
  }

  const [lo, hi] =
    node.gapMs === undefined
      ? [undefined, undefined]
      : typeof node.gapMs === 'number'
        ? [undefined, node.gapMs]
        : node.gapMs;

  if (node.edge === 'near') {
    // distance = MAX(anchor start − root end, root start − anchor end, 0)
    const distance = `MAX(${t}.s - ${rootEnd}, ${rootTime} - ${t}.e, 0)`;
    const lower = reach(hi!);
    ctx.params.push(hi!);
    const upper = `${t}.s <= ${rootEnd} + ?`;
    if (lo === undefined) {
      ctx.params.push(hi!);
      return exists(`${lower} AND ${upper} AND ${distance} < ?`);
    }
    ctx.params.push(lo, hi!);
    return exists(`${lower} AND ${upper} AND ${distance} >= ? AND ${distance} <= ?`);
  }

  if (node.edge === 'before' || node.edge === 'until') {
    // The anchor starts after the root ends: distance = anchor start − root end.
    const distance = `${t}.s - ${rootEnd}`;
    if (hi === undefined) return exists(`${t}.s > ${rootEnd}`);
    ctx.params.push(hi);
    const upper = `${t}.s <= ${rootEnd} + ?`;
    if (lo === undefined) {
      ctx.params.push(hi);
      return exists(`${t}.s > ${rootEnd} AND ${upper} AND ${distance} < ?`);
    }
    ctx.params.push(lo, hi);
    return exists(`${t}.s > ${rootEnd} AND ${upper} AND ${distance} >= ? AND ${distance} <= ?`);
  }

  // after / since: the anchor ended before the root starts —
  // distance = root start − anchor end.
  const distance = `${rootTime} - ${t}.e`;
  if (hi === undefined) return exists(`${t}.s < ${rootTime} AND ${t}.e < ${rootTime}`);
  const lower = reach(hi);
  if (lo === undefined) {
    ctx.params.push(hi);
    return exists(`${lower} AND ${t}.e < ${rootTime} AND ${distance} < ?`);
  }
  ctx.params.push(lo, hi);
  return exists(`${lower} AND ${t}.e < ${rootTime} AND ${distance} >= ? AND ${distance} <= ?`);
}

function compileActionNode(node: ConstraintNode, ctx: Ctx, alias = 'a'): string {
  switch (node.type) {
    case 'type': {
      const types = [...new Set([node.value, ...getAllSubtypes(node.value)])];
      ctx.params.push(...types);
      return maybeNegate(`${alias}.type IN (${types.map(() => '?').join(', ')})`, node.negated);
    }
    case 'association': {
      if (ACTION_EDGE_ROLES.has(node.property)) {
        if (node.property === 'with' && node.gapMs !== undefined) {
          // A windowed `with` on an action root relates happenings: the root
          // within the window of an anchor action — "X and Y on the same day"
          // is `type:X with(1d):{ type:Y … }`. The anchor must be action-shaped;
          // an entity anchor stays the role slot, which takes no window.
          if (inferQueryTarget(node.constraints) !== 'actions') {
            throw new UnsupportedConstraintError(
              `with(…):{…} on an action relates it to other ACTIONS within the window — give the anchor a type or a time (with(1d):{ type:VisitAction … }). The with:{…} role slot takes no window.`
            );
          }
          return maybeNegate(
            compilePseudoEvent(
              { type: 'pseudoEdge', edge: 'near', anchor: node.constraints, gapMs: node.gapMs },
              `${alias}.occurred_at`,
              ctx,
              `COALESCE(${alias}.end_time, ${alias}.occurred_at)`,
              alias
            ),
            node.negated
          );
        }
        return maybeNegate(compileRoleEdges(node, ctx, alias), node.negated);
      }
      if (node.cardinality !== undefined) {
        // Single-FK role slots have at most one filler; multi-valued roles
        // (recipient, attendee) are not yet in derived state — counting them
        // needs the fold's action-role-edges table.
        throw new UnsupportedConstraintError(
          `Cardinality on action role "${node.property}" needs the action-role-edges fold.`
        );
      }
      // An action's location is a location VALUE; a named place reaches its
      // entity through the value's up-link (`location:{ name:"Tokyo" }`).
      if (node.property === 'location') {
        const role = `r${ctx.params.length}`;
        const nested = node.constraints.map(c => compile(c, role, ctx)).join(' AND ');
        return maybeNegate(
          `EXISTS (SELECT 1 FROM location_values lv${role}` +
            ` JOIN entities ${role} ON ${role}.id = lv${role}.cached_entity_id` +
            ` WHERE lv${role}.id = ${alias}.location_location_id${nested === '' ? '' : ` AND ${nested}`})`,
          node.negated
        );
      }
      const col = ACTION_ROLE_COLUMNS[node.property];
      if (col === undefined) {
        throw new UnsupportedConstraintError(
          `Association "${node.property}" is not supported in action queries.`
        );
      }
      const role = `r${ctx.params.length}`;
      const outer = ctx.outerRefs ?? 0;
      const nested = node.constraints
        .map(c => compile(substituteAtAnchor(c, `${alias}.occurred_at`), role, ctx))
        .join(' AND ');
      if (nested === '' || (ctx.outerRefs ?? 0) !== outer) {
        return maybeNegate(
          `EXISTS (SELECT 1 FROM entities ${role} WHERE ${role}.id = ${alias}.${col}${nested === '' ? '' : ` AND ${nested}`})`,
          node.negated
        );
      }
      // The role fillers that match, found once; the slot is NULL-guarded so
      // a negated match keeps the actions with the slot empty.
      return maybeNegate(
        `(${alias}.${col} IS NOT NULL AND ${alias}.${col} IN (SELECT ${role}.id FROM entities ${role} WHERE ${nested}))`,
        node.negated
      );
    }
    case 'property': {
      if (node.property === 'id') {
        if (node.operator !== 'equals' || node.value === undefined) {
          throw new UnsupportedConstraintError(
            `id: selects by content identity — id:"<content IRI or key>".`
          );
        }
        ctx.params.push(contentKeyOf(node.value));
        return maybeNegate(`${alias}.key = ?`, node.negated);
      }
      if (node.property === 'attachment') {
        return maybeNegate(compileAttachment(node, undefined, alias, ctx), node.negated);
      }
      if (ACTION_EDGE_ROLES.has(node.property)) {
        const re = `re${ctx.params.length}`;
        ctx.params.push(node.property);
        const base = `${re}.action_id = ${alias}.id AND ${re}.role = ?`;
        if (node.operator === 'exists') {
          return maybeNegate(
            `EXISTS (SELECT 1 FROM action_role_edges ${re} WHERE ${base})`,
            node.negated
          );
        }
        if (node.operator === 'equals' && node.value !== undefined) {
          if (isAnchorValue(node.value)) {
            ctx.params.push(requireSelf(ctx));
            return maybeNegate(
              `EXISTS (SELECT 1 FROM action_role_edges ${re} WHERE ${base} AND ${re}.cached_entity_id = ?)`,
              node.negated
            );
          }
          ctx.params.push(node.value);
          return maybeNegate(
            `EXISTS (SELECT 1 FROM action_role_edges ${re} JOIN entities ${re}_e ON ${re}_e.id = ${re}.cached_entity_id WHERE ${base} AND ${re}_e.cached_name = ?)`,
            node.negated
          );
        }
        throw new UnsupportedConstraintError(
          `Operator "${node.operator}" is not supported on role "${node.property}".`
        );
      }
      const roleCol = ACTION_ROLE_COLUMNS[node.property];
      if (roleCol !== undefined) {
        if (node.operator === 'exists') {
          return maybeNegate(`${alias}.${roleCol} IS NOT NULL`, node.negated);
        }
        if (node.operator === 'equals' && node.value !== undefined) {
          // `agent:@me` / `object:@me` — match the role by the self entity id, a
          // direct FK comparison (identity, not name).
          if (isAnchorValue(node.value)) {
            ctx.params.push(requireSelf(ctx));
            return maybeNegate(`${alias}.${roleCol} = ?`, node.negated);
          }
          // `object:"1984"` matches the role entity's elected name
          ctx.params.push(node.value);
          return maybeNegate(
            `(${alias}.${roleCol} IS NOT NULL AND ${alias}.${roleCol} IN (SELECT id FROM entities WHERE cached_name = ?))`,
            node.negated
          );
        }
        throw new UnsupportedConstraintError(
          `Operator "${node.operator}" is not supported on action role "${node.property}".`
        );
      }
      const timeCol = ACTION_TIME_COLUMNS[node.property];
      if (timeCol !== undefined) {
        return maybeNegate(compileActionTime(node, timeCol, ctx, alias), node.negated);
      }
      if (node.property === 'duration') {
        return maybeNegate(compileDuration(node, ctx, alias), node.negated);
      }
      if (node.property === 'source' || node.property === 'sourceId') {
        const col = node.property === 'source' ? `${alias}.source` : `${alias}.source_id`;
        if (node.operator === 'exists') {
          return maybeNegate(`${col} IS NOT NULL`, node.negated);
        }
        if (node.operator === 'equals' && node.value !== undefined) {
          ctx.params.push(requireLiteral(node.value, node.property));
          return maybeNegate(`${col} = ?`, node.negated);
        }
      }
      throw new UnsupportedConstraintError(
        `Property "${node.property}" is not supported in action queries.`
      );
    }
    case 'fulltext': {
      // A predicate restricts the node it acts on, and an action carries no
      // text of its own. Probing every participant here (as v1 did) silently
      // fans one predicate across five edges — and masks wrong-slot mistakes
      // instead of teaching them. Refuse with the explicit spellings.
      throw new UnsupportedConstraintError(
        `Bare text does not apply to an action — actions carry no text of their own. ` +
          `Restrict the participant you mean: object:{ ${node.value} }, result:{ ${node.value} }, or agent:{ ${node.value} }.`
      );
    }
    case 'similar': {
      // Same shape as fulltext: an action has no card to be similar to.
      throw new UnsupportedConstraintError(
        `"~" does not apply to an action — similarity ranks entities. ` +
          `Restrict the participant you mean: object:{ ~"${node.text}" } or agent:{ ~"${node.text}" }.`
      );
    }
    case 'and':
      return `(${node.constraints.map(c => compileActionNode(c, ctx, alias)).join(' AND ')})`;
    case 'or':
      return `(${node.constraints.map(c => compileActionNode(c, ctx, alias)).join(' OR ')})`;
    case 'pseudoEdge': {
      const rootEnd = `COALESCE(${alias}.end_time, ${alias}.occurred_at)`;
      // `while:{ … }` reads its anchor's shape: an action anchor (a type, a
      // time, a role) relates two happenings — the root overlaps the anchor's
      // occurrence; an entity-shaped anchor pins the agent's validity runs at
      // the row's own time (where someone lived, worked).
      if (node.edge === 'while' && inferQueryTarget(node.anchor) !== 'actions') {
        return maybeNegate(
          compileWhile(node, `${alias}.cached_agent_entity_id`, `${alias}.occurred_at`, ctx),
          node.negated
        );
      }
      return maybeNegate(
        compilePseudoEvent(node, `${alias}.occurred_at`, ctx, rootEnd, alias),
        node.negated
      );
    }
    default:
      throw new UnsupportedConstraintError(
        `Constraint "${(node as ConstraintNode).type}" is not supported in action queries.`
      );
  }
}
