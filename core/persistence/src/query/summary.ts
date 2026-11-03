import { getAllSubproperties } from '../annotations/schema.js';
import type { SqliteDriver } from '../db/driver.js';
import { getPredicateAnnotation } from '../annotations/ontology.js';
import { isAnchorValue, type ConstraintNode } from '@chronicle.app/cql';
import { compileActionWhere, compileEntityWhere, UnsupportedConstraintError } from './evaluate.js';
import type { CompiledWhere, SimilarResolutions } from './evaluate.js';

/**
 * Aggregation in the store: every breakdown an agent reads is computed
 * in SQL over the FULL matched set, never over a materialized slice. Three
 * surfaces share the compiled restriction the page reads:
 *
 *   - `countActionsBy` / `countEntitiesBy` — `--count-by <dimension>`, where a
 *     dimension is a column (`type`, `source`), a time bucket
 *     (`timestamp:year|month|day`), an episode split (`timestamp:gap(3d)`), a
 *     geographic cell (`location:geo(50km)`), or any field path off the root
 *     (`agent.name`, `object.artist.name`, `location.name`, `object.travelMode`);
 *   - `summarizeActions` / `summarizeEntities` — the `summary` block of the query
 *     envelope: the total, the span, a few facets chosen from the query's own
 *     footprint, and the census of which fields are populated and how densely.
 */

export interface CountBucket {
  key: string;
  count: number;
}

/** A `--count-by` dimension — see the module doc for the grammar. */
export type CountByDimension = string;

export interface QuerySummary {
  /** Rows in the whole matched set. */
  total: number;
  /** The set's occurrence span as `[first, last]` calendar dates (actions only). */
  span?: [string, string];
  /** Breakdowns keyed by dimension, each `[key, count]` pairs, largest first;
   *  a trailing `@other` pair carries what the top pairs leave out. */
  facets: Record<string, [string, number][]>;
  /** How many rows populate each field path — the root's columns and roles, and
   *  the subject's stored predicates one hop down. Zero is listed for the slots
   *  an agent is likeliest to ask for and find empty. */
  census: Record<string, number>;
}

interface CountOptions {
  similar?: SimilarResolutions;
  /** Cap on buckets; absent = every bucket. */
  limit?: number;
  /** The feed window (actions only) — the same restriction the page reads. */
  from?: number;
  to?: number;
}

// ---------------------------------------------------------------------------
// Dimension grammar
// ---------------------------------------------------------------------------

type Dimension =
  | { kind: 'column'; column: 'type' | 'source' }
  | { kind: 'time'; unit: 'year' | 'month' | 'day' }
  | { kind: 'gap'; ms: number }
  | { kind: 'geo'; km: number }
  | { kind: 'path'; segments: string[] };

const TIME_FMT: Record<'year' | 'month' | 'day', string> = {
  year: '%Y',
  month: '%Y-%m',
  day: '%Y-%m-%d',
};

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

const DIMENSION_HELP =
  'type, source, timestamp:year|month|day, timestamp:gap(<duration>), location:geo(<km>), or a field path such as agent.name, object.artist.name, location.name';

export function parseDimension(dim: string): Dimension {
  const raw = dim.trim();
  if (raw === 'type' || raw === 'source') return { kind: 'column', column: raw };
  const time = /^timestamp:(year|month|day)$/.exec(raw);
  if (time) return { kind: 'time', unit: time[1] as 'year' | 'month' | 'day' };
  const gap = /^timestamp:gap\((\d+(?:\.\d+)?)([smhdw])\)$/.exec(raw);
  if (gap) return { kind: 'gap', ms: Number(gap[1]) * DURATION_UNITS[gap[2]] };
  const geo = /^location:geo\((\d+(?:\.\d+)?)km\)$/.exec(raw);
  if (geo) return { kind: 'geo', km: Number(geo[1]) };
  if (/^[A-Za-z@][\w@]*(\.[A-Za-z@][\w@]*)*$/.test(raw)) {
    return { kind: 'path', segments: raw.split('.') };
  }
  throw new UnsupportedConstraintError(
    `--count-by "${dim}" is not a dimension: ${DIMENSION_HELP}.`
  );
}

// ---------------------------------------------------------------------------
// Field paths — a JOIN chain from the root alias to a key expression
// ---------------------------------------------------------------------------

const ACTION_ROLE_COLUMNS: Record<string, string> = {
  agent: 'cached_agent_entity_id',
  object: 'cached_object_entity_id',
  result: 'cached_result_entity_id',
  instrument: 'cached_instrument_entity_id',
  target: 'cached_target_entity_id',
};

/** The concrete predicates a path segment names: a family anchor fans out. */
function predicateMembers(name: string): string[] {
  const subs = getAllSubproperties(name).filter(p => getPredicateAnnotation(p) !== undefined);
  if (subs.length > 0) return subs.sort();
  return getPredicateAnnotation(name) === undefined ? [] : [name];
}

/**
 * A grouping plan: the FROM clause (root table plus joins) with its params, and
 * the key expression with its own. They are kept apart because the key is
 * SELECTed before the joins appear in the SQL text, and params are positional.
 */
interface GroupPlan {
  from: string;
  fromParams: unknown[];
  key: string;
  keyParams: unknown[];
  /** The root's id column — a bucket counts distinct roots, never joined rows. */
  root: string;
}

/**
 * Compile a dotted path into joins and a key expression. The first segment is
 * where the walk begins: on an action root a role slot (`agent`, `object`,
 * `location`, …) or a column (`type`, `source`); on an entity root a predicate.
 * Middle segments are entity-valued predicates (open runs, harmonized grain);
 * the terminal is `name` (the elected name, the ego collapsed to `@me`),
 * `@type` (the entity's types), a literal predicate (its value), or an
 * entity-valued predicate (its target's name).
 */
function compilePath(
  root: 'actions' | 'entities',
  segments: string[],
  selfId: number | null
): GroupPlan {
  const fromParams: unknown[] = [];
  const joins: string[] = [];
  const table = root === 'actions' ? 'actions a' : 'entities e';
  const rootId = root === 'actions' ? 'a.id' : 'e.id';
  const plan = (key: string, keyParams: unknown[] = []): GroupPlan => ({
    from: [table, ...joins].join(' '),
    fromParams,
    key,
    keyParams,
    root: rootId,
  });
  let n = 0;
  let alias: string; // the current entity alias
  let rest: string[];

  if (root === 'actions') {
    const [head, ...tail] = segments;
    rest = tail;
    if (head === 'type' || head === 'source') {
      if (tail.length > 0) {
        throw new UnsupportedConstraintError(
          `"${head}" is a column — it has no fields beneath it.`
        );
      }
      return plan(`a.${head}`);
    }
    if (head === 'location') {
      alias = `e${n++}`;
      joins.push(
        `JOIN location_values lv${alias} ON lv${alias}.id = a.location_location_id`,
        `JOIN entities ${alias} ON ${alias}.id = lv${alias}.cached_entity_id`
      );
    } else if (ACTION_ROLE_COLUMNS[head] === undefined) {
      throw new UnsupportedConstraintError(
        `A path on an action starts at a role slot (agent, object, result, instrument, target, location) or a column (type, source) — not "${head}".`
      );
    } else {
      alias = `e${n++}`;
      joins.push(`JOIN entities ${alias} ON ${alias}.id = a.${ACTION_ROLE_COLUMNS[head]}`);
    }
    if (rest.length === 0) rest = ['name'];
  } else {
    alias = 'e';
    rest = segments;
  }

  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i];
    const last = i === rest.length - 1;
    if (last && seg === 'name') {
      return selfId === null
        ? plan(`${alias}.cached_name`)
        : plan(`CASE WHEN ${alias}.id = ? THEN '@me' ELSE ${alias}.cached_name END`, [selfId]);
    }
    if (last && seg === '@type') {
      const et = `et${n++}`;
      joins.push(`JOIN entity_types ${et} ON ${et}.entity_id = ${alias}.id`);
      return plan(`${et}.type`);
    }
    const members = predicateMembers(seg);
    if (members.length === 0) {
      throw new UnsupportedConstraintError(
        `"${seg}" is not a property in the ontology — a path walks properties (artist, author, recipient, partOf, …) and ends at name, @type, or a literal property.`
      );
    }
    const entityRange = members.every(m => getPredicateAnnotation(m)!.isEntityRange);
    const single = members.every(m => (getPredicateAnnotation(m)!.cardinality ?? 'one') === 'one');
    const p = `p${n}`;
    const placeholders = members.map(() => '?').join(', ');
    fromParams.push(...members);
    if (single) {
      // A single-valued predicate has ONE current value per entity — the one
      // serialization elects. Two sources may both hold an open run (a
      // conflict), so the join takes the election's winner, in the fold's own
      // order (`compareCandidates`): grade, a source's own record over a url
      // sighting, the canonical address, recency, then the keys.
      joins.push(
        `JOIN (SELECT pp.cached_entity_id, pp.cached_object_entity_id, pp.value_id, ROW_NUMBER() OVER (` +
          `PARTITION BY pp.cached_entity_id ORDER BY pp.grade DESC, (se.source != 'url') DESC, ` +
          `EXISTS (SELECT 1 FROM properties c WHERE c.predicate = 'canonicalVersion' AND c.value_sourced_id = pp.sourced_entity_id AND c.cached_period_to IS NULL) DESC, ` +
          `pp.last_confirmed_valid_at DESC, pp.last_confirmed_observed_at DESC, se.key, COALESCE(vse.key, v.key, lv.key)) AS rn` +
          ` FROM properties pp JOIN sourced_entities se ON se.id = pp.sourced_entity_id` +
          ` LEFT JOIN vals v ON v.id = pp.value_id LEFT JOIN sourced_entities vse ON vse.id = pp.value_sourced_id` +
          ` LEFT JOIN location_values lv ON lv.id = pp.value_location_id` +
          ` WHERE pp.predicate IN (${placeholders}) AND pp.cached_period_to IS NULL AND pp.agent_sourced_id IS NULL) ${p}` +
          ` ON ${p}.cached_entity_id = ${alias}.id AND ${p}.rn = 1`
      );
    } else {
      // A many-valued predicate's current value is the union of open runs; the
      // grouped select counts each root once per distinct key, so two sources
      // asserting the same value never count twice.
      joins.push(
        `JOIN properties ${p} ON ${p}.cached_entity_id = ${alias}.id AND ${p}.predicate IN (${placeholders}) AND ${p}.cached_period_to IS NULL AND ${p}.agent_sourced_id IS NULL`
      );
    }
    if (entityRange) {
      const next = `e${n++}`;
      joins.push(`JOIN entities ${next} ON ${next}.id = ${p}.cached_object_entity_id`);
      alias = next;
      if (last) {
        // An entity-valued terminal buckets by its target's name.
        rest = [...rest, 'name'];
      }
      continue;
    }
    if (!last) {
      throw new UnsupportedConstraintError(
        `"${seg}" holds a literal value — nothing lies beneath it; end the path there.`
      );
    }
    const v = `v${n++}`;
    joins.push(`JOIN vals ${v} ON ${v}.id = ${p}.value_id`);
    return plan(`json_extract(${v}.body, '$')`);
  }
  throw new UnsupportedConstraintError(`An empty path names nothing.`);
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** A plan over the root table alone, keyed by a column or expression. */
const columnPlan = (from: string, key: string): GroupPlan => ({
  from,
  fromParams: [],
  key,
  keyParams: [],
  root: from.startsWith('actions') ? 'a.id' : 'e.id',
});

/**
 * The grouped SELECT every bucket query shares: `key, count` per distinct key,
 * null keys dropped, each ROOT counted once per key — a join that fans a root
 * out (a many-valued edge, two sources asserting one value) never inflates a
 * bucket. Params in SQL text order: root, key, from, where.
 */
function groupedSelect(plan: GroupPlan, where: CompiledWhere): { sql: string; params: unknown[] } {
  return {
    sql:
      `SELECT key, COUNT(*) AS count FROM (SELECT DISTINCT ${plan.root} AS root, ${plan.key} AS key FROM ${plan.from} WHERE ${where.where})` +
      ` WHERE key IS NOT NULL GROUP BY 1`,
    params: [...plan.keyParams, ...plan.fromParams, ...where.params],
  };
}

/** Buckets for a grouped key: largest first (or key order for time buckets). */
function groupedBuckets(
  sqlite: SqliteDriver,
  plan: GroupPlan,
  where: CompiledWhere,
  order: 'count' | 'key',
  limit?: number
): CountBucket[] {
  const orderBy = order === 'key' ? 'key' : 'count DESC, key';
  const cap = limit === undefined ? '' : ` LIMIT ${Number(limit)}`;
  const { sql, params } = groupedSelect(plan, where);
  return sqlite.prepare(`${sql} ORDER BY ${orderBy}${cap}`).all(...params) as CountBucket[];
}

const DAY_MS = 86_400_000;
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The object entity's own open `location` value — the venue's point. */
const objectLocation = (col: string): string =>
  `(SELECT lv.${col} FROM properties p JOIN location_values lv ON lv.id = p.value_location_id` +
  ` WHERE p.cached_entity_id = a.cached_object_entity_id AND p.predicate = 'location'` +
  ` AND p.cached_period_to IS NULL AND p.agent_sourced_id IS NULL LIMIT 1)`;

/**
 * Episodes: the set sorted by occurrence and split wherever the next action
 * starts more than `ms` after everything before it ended. Each bucket's key is
 * the episode's date range, plus its most frequent object when it has one —
 * "every trip to Montreal" as one line per trip.
 */
function gapBuckets(
  sqlite: SqliteDriver,
  where: CompiledWhere,
  ms: number,
  limit?: number
): CountBucket[] {
  const rows = sqlite
    .prepare(
      `WITH m AS (
         SELECT a.occurred_at AS t, COALESCE(a.end_time, a.occurred_at) AS e, oe.cached_name AS obj
         FROM actions a LEFT JOIN entities oe ON oe.id = a.cached_object_entity_id
         WHERE ${where.where}
       ), b AS (
         SELECT t, e, obj,
           CASE WHEN t - MAX(e) OVER (ORDER BY t, e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) > ? THEN 1 ELSE 0 END AS brk
         FROM m
       ), g AS (
         SELECT t, e, obj, SUM(brk) OVER (ORDER BY t, e ROWS UNBOUNDED PRECEDING) AS grp FROM b
       )
       SELECT grp, obj, COUNT(*) AS n,
         MIN(MIN(t)) OVER (PARTITION BY grp) AS start,
         MAX(MAX(e)) OVER (PARTITION BY grp) AS finish,
         SUM(COUNT(*)) OVER (PARTITION BY grp) AS total
       FROM g GROUP BY grp, obj ORDER BY grp, n DESC`
    )
    .all(...where.params, ms) as Array<{
    grp: number;
    obj: string | null;
    n: number;
    start: number;
    finish: number;
    total: number;
  }>;
  const out: CountBucket[] = [];
  let seen = -1;
  for (const r of rows) {
    if (r.grp === seen) continue; // the first row per episode is its top object
    seen = r.grp;
    const range =
      day(r.start) === day(r.finish) ? day(r.start) : `${day(r.start)}..${day(r.finish)}`;
    out.push({ key: r.obj ? `${range} · ${r.obj}` : range, count: r.total });
  }
  return limit === undefined ? out : out.slice(0, limit);
}

/**
 * Geographic areas: each located action (its own location, else its object's)
 * falls in a grid cell `km` across; a bucket is a cell's centroid plus its most
 * frequent object — a name match that spans two cities shows as two lines.
 */
function geoBuckets(
  sqlite: SqliteDriver,
  where: CompiledWhere,
  km: number,
  limit?: number
): CountBucket[] {
  const deg = km / 111;
  const rows = sqlite
    .prepare(
      `WITH m AS (
         SELECT COALESCE(lva.latitude, ${objectLocation('latitude')}) AS lat,
                COALESCE(lva.longitude, ${objectLocation('longitude')}) AS lon,
                oe.cached_name AS obj
         FROM actions a
         LEFT JOIN location_values lva ON lva.id = a.location_location_id
         LEFT JOIN entities oe ON oe.id = a.cached_object_entity_id
         WHERE ${where.where}
       ), c AS (
         SELECT ROUND(lat / ?) AS cy, ROUND(lon / ?) AS cx, lat, lon, obj FROM m WHERE lat IS NOT NULL AND lon IS NOT NULL
       )
       SELECT cy, cx, obj, COUNT(*) AS n,
         AVG(lat) AS lat, AVG(lon) AS lon,
         SUM(COUNT(*)) OVER (PARTITION BY cy, cx) AS total
       FROM c GROUP BY cy, cx, obj ORDER BY total DESC, cy, cx, n DESC`
    )
    .all(...where.params, deg, deg) as Array<{
    cy: number;
    cx: number;
    obj: string | null;
    n: number;
    lat: number;
    lon: number;
    total: number;
  }>;
  const out: CountBucket[] = [];
  let seen = '';
  for (const r of rows) {
    const cell = `${r.cy},${r.cx}`;
    if (cell === seen) continue;
    seen = cell;
    const at = `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`;
    out.push({ key: r.obj ? `${at} · ${r.obj}` : at, count: r.total });
  }
  return limit === undefined ? out : out.slice(0, limit);
}

export function countActionsBy(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  dim: CountByDimension,
  options: CountOptions = {}
): CountBucket[] {
  const where = compileActionWhere(sqlite, ast, options);
  const d = parseDimension(dim);
  switch (d.kind) {
    case 'column':
      return groupedBuckets(
        sqlite,
        columnPlan('actions a', `a.${d.column}`),
        where,
        'count',
        options.limit
      );
    case 'time':
      return groupedBuckets(
        sqlite,
        columnPlan(
          'actions a',
          `strftime('${TIME_FMT[d.unit]}', a.occurred_at / 1000.0, 'unixepoch')`
        ),
        where,
        'key',
        options.limit
      );
    case 'gap':
      return gapBuckets(sqlite, where, d.ms, options.limit);
    case 'geo':
      return geoBuckets(sqlite, where, d.km, options.limit);
    case 'path':
      return groupedBuckets(
        sqlite,
        compilePath('actions', d.segments, where.selfId),
        where,
        'count',
        options.limit
      );
    default:
      return [];
  }
}

export function countEntitiesBy(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  dim: CountByDimension,
  options: CountOptions = {}
): CountBucket[] {
  const where = compileEntityWhere(sqlite, ast, options);
  const d = parseDimension(dim);
  switch (d.kind) {
    case 'column':
      // Protocol namespaces (`url`, `email`, `phone`, `isbn`) bucket alongside
      // products: "things I know only by their address" is a real answer, and
      // every sourced row names the namespace its identity belongs to.
      return d.column === 'type'
        ? groupedBuckets(
            sqlite,
            columnPlan('entities e JOIN entity_types et ON et.entity_id = e.id', 'et.type'),
            where,
            'count',
            options.limit
          )
        : (sqlite
            .prepare(
              `SELECT se.source AS key, COUNT(DISTINCT e.id) AS count FROM entities e JOIN sourced_entities se ON se.entity_id = e.id WHERE ${where.where} GROUP BY 1 ORDER BY count DESC, key${options.limit === undefined ? '' : ` LIMIT ${Number(options.limit)}`}`
            )
            .all(...where.params) as CountBucket[]);
    case 'time':
    case 'gap':
      throw new UnsupportedConstraintError(
        `--count-by ${dim} needs an action query — root on the action (e.g. type:ListenAction).`
      );
    case 'geo':
      throw new UnsupportedConstraintError(
        `--count-by ${dim} buckets located actions — root on the action (e.g. type:VisitAction).`
      );
    case 'path':
      return groupedBuckets(
        sqlite,
        compilePath('entities', d.segments, where.selfId),
        where,
        'count',
        options.limit
      );
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// The summary: total, span, facets, census — over the full set
// ---------------------------------------------------------------------------

/** How many top pairs a summary facet carries before folding the rest into `@other`. */
const FACET_TOP = 8;
/** How many footprint facets a summary carries beyond time and source. */
const FACET_MAX = 3;
/** How many candidate breakdowns the summary may try to find those. */
const CANDIDATE_BUDGET = 6;

/**
 * Store-internal or content-shaped predicates that never make a breakdown: free
 * text groups one row per value, addresses and dates are continuous, a blob
 * address is machinery. Everything else the census finds is a candidate.
 */
const NON_FACET_PREDICATES = new Set([
  'name',
  'body',
  'text',
  'description',
  'url',
  'path',
  'matchedPath',
  'attachmentCid',
  'identifier',
]);
const NON_FACET_RANGES = new Set(['DateTime', 'URL', 'Number', 'Selector']);

/** A breakdown grouped by `key`: the top pairs plus `@other`, and how many
 *  distinct keys there were — so a candidate that does not group is dropped. */
function facetOf(
  sqlite: SqliteDriver,
  plan: GroupPlan,
  where: CompiledWhere,
  order: 'count' | 'key',
  top?: number
): { pairs: [string, number][]; distinct: number; total: number } {
  const orderBy = order === 'key' ? 'key' : 'count DESC, key';
  const cap = top === undefined ? '' : ` LIMIT ${Number(top)}`;
  const grouped = groupedSelect(plan, where);
  const rows = sqlite
    .prepare(
      `SELECT key, count, COUNT(*) OVER () AS distinct_keys, SUM(count) OVER () AS total FROM (` +
        grouped.sql +
        `) ORDER BY ${orderBy}${cap}`
    )
    .all(...grouped.params) as Array<{
    key: string | number;
    count: number;
    distinct_keys: number;
    total: number;
  }>;
  const pairs: [string, number][] = rows.map(r => [String(r.key), r.count]);
  const distinct = rows[0]?.distinct_keys ?? 0;
  const total = rows[0]?.total ?? 0;
  const shown = pairs.reduce((sum, [, n]) => sum + n, 0);
  if (top !== undefined && distinct > pairs.length && total > shown) {
    pairs.push(['@other', total - shown]);
  }
  return { pairs, distinct, total };
}

/** The time bucket a span reads best at: years past two years, months past two
 *  months, else days. */
function timeUnit(lo: number, hi: number): 'year' | 'month' | 'day' {
  const days = (hi - lo) / DAY_MS;
  return days > 730 ? 'year' : days > 62 ? 'month' : 'day';
}

/**
 * The paths a query pins to one value, which no facet should repeat: a role
 * whose sub-query names an exact `name` (`agent:{ name:"X" }`), the ego in a
 * role (`agent:@me`), and a nested predicate named the same way
 * (`object:{ artist:{ name:"X" } }`). A facet over a pinned path is one bar.
 */
function pinnedPaths(ast: ConstraintNode[], prefix = ''): Set<string> {
  const pinned = new Set<string>();
  const pinsName = (nodes: ConstraintNode[]): boolean =>
    nodes.some(
      n =>
        n.type === 'property' &&
        (n.property === 'name' || n.property === 'id') &&
        n.operator === 'equals' &&
        n.negated !== true
    );
  for (const node of ast) {
    if (node.type === 'association' && node.negated !== true) {
      const path = prefix ? `${prefix}.${node.property}` : node.property;
      if (pinsName(node.constraints)) pinned.add(`${path}.name`);
      for (const p of pinnedPaths(node.constraints, path)) pinned.add(p);
    } else if (
      node.type === 'property' &&
      node.operator === 'equals' &&
      node.negated !== true &&
      isAnchorValue(node.value)
    ) {
      // `agent:@me` — an anchor value in a role slot.
      pinned.add(`${prefix ? `${prefix}.` : ''}${node.property}.name`);
    } else if (node.type === 'and') {
      for (const p of pinnedPaths(node.constraints, prefix)) pinned.add(p);
    }
  }
  return pinned;
}

/** A candidate facet path drawn from the census, in preference order. */
interface Candidate {
  path: string;
  coverage: number;
}

/**
 * Candidates from the census: every populated edge off the root (`agent.name`,
 * `object.recipient.name`, `object.artist.name`, …) and every populated literal
 * that can group (`result.travelMode`), ordered by how densely they are
 * populated. Not a hard-coded list — whatever the matched set actually carries.
 */
function candidatesFrom(
  census: Record<string, number>,
  root: 'actions' | 'entities',
  pinned: Set<string>
): Candidate[] {
  const out: Candidate[] = [];
  for (const [path, coverage] of Object.entries(census)) {
    if (coverage === 0) continue;
    const segments = path.split('.');
    const leaf = segments.at(-1)!;
    if (root === 'actions' && segments.length === 1) {
      // A role slot facets by its filler's name; the columns do not.
      if (ACTION_ROLE_COLUMNS[leaf] !== undefined || leaf === 'location') {
        const p = `${path}.name`;
        if (!pinned.has(p)) out.push({ path: p, coverage });
      }
      continue;
    }
    if (leaf === 'attachment' || NON_FACET_PREDICATES.has(leaf)) continue;
    const ann = getPredicateAnnotation(leaf);
    if (ann === undefined) continue;
    if (ann.isEntityRange) {
      const p = `${path}.name`;
      if (!pinned.has(p)) out.push({ path: p, coverage });
    } else if (!NON_FACET_RANGES.has(ann.range)) {
      out.push({ path, coverage });
    }
  }
  // Entity-valued edges first (they name things), then literals; denser first.
  return out.sort((x, y) => {
    const ex = x.path.endsWith('.name') ? 0 : 1;
    const ey = y.path.endsWith('.name') ? 0 : 1;
    return ex - ey || y.coverage - x.coverage || x.path.localeCompare(y.path);
  });
}

/** Coverage of the subject slots' stored predicates over the matched actions. */
function subjectCensus(
  sqlite: SqliteDriver,
  where: CompiledWhere,
  slot: 'object' | 'result' | 'target'
): Record<string, number> {
  const rows = sqlite
    .prepare(
      `SELECT p.predicate AS predicate, COUNT(DISTINCT a.id) AS n FROM actions a` +
        ` JOIN properties p ON p.cached_entity_id = a.${ACTION_ROLE_COLUMNS[slot]} AND p.cached_period_to IS NULL AND p.agent_sourced_id IS NULL` +
        ` WHERE ${where.where} GROUP BY 1 ORDER BY 1`
    )
    .all(...where.params) as Array<{ predicate: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows)
    out[`${slot}.${r.predicate === 'attachmentCid' ? 'attachment' : r.predicate}`] = r.n;
  return out;
}

export function summarizeActions(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { similar?: SimilarResolutions; from?: number; to?: number } = {}
): QuerySummary {
  const where = compileActionWhere(sqlite, ast, options);
  const head = sqlite
    .prepare(
      `SELECT COUNT(*) AS total, MIN(a.occurred_at) AS lo, MAX(COALESCE(a.end_time, a.occurred_at)) AS hi,` +
        ` COUNT(a.start_time) AS startTime, COUNT(a.end_time) AS endTime,` +
        ` COUNT(a.cached_agent_entity_id) AS agent, COUNT(a.cached_object_entity_id) AS object,` +
        ` COUNT(a.location_location_id) AS location, COUNT(a.cached_result_entity_id) AS result,` +
        ` COUNT(a.cached_instrument_entity_id) AS instrument, COUNT(a.cached_target_entity_id) AS target` +
        ` FROM actions a WHERE ${where.where}`
    )
    .get(...where.params) as {
    total: number;
    lo: number | null;
    hi: number | null;
    startTime: number;
    endTime: number;
    agent: number;
    object: number;
    location: number;
    result: number;
    instrument: number;
    target: number;
  };
  const census: Record<string, number> = {
    timestamp: head.total,
    startTime: head.startTime,
    endTime: head.endTime,
    agent: head.agent,
    object: head.object,
    location: head.location,
    result: head.result,
    instrument: head.instrument,
    target: head.target,
  };
  for (const slot of ['object', 'result', 'target'] as const) {
    if (head[slot] === 0) continue;
    Object.assign(census, subjectCensus(sqlite, where, slot));
    // The recurring trap, listed even when empty: a chat source's photos are
    // usually not folded, and an agent should see the zero, not search for it.
    census[`${slot}.attachment`] ??= 0;
  }
  const summary: QuerySummary = { total: head.total, facets: {}, census };
  if (head.total === 0 || head.lo === null || head.hi === null) return summary;
  summary.span = [day(head.lo), day(head.hi)];

  if (head.total > 1) {
    const unit = timeUnit(head.lo, head.hi);
    const time = facetOf(
      sqlite,
      columnPlan('actions a', `strftime('${TIME_FMT[unit]}', a.occurred_at / 1000.0, 'unixepoch')`),
      where,
      'key'
    );
    if (time.distinct > 1) summary.facets[`timestamp:${unit}`] = time.pairs;
    const source = facetOf(sqlite, columnPlan('actions a', 'a.source'), where, 'count', FACET_TOP);
    if (source.distinct > 1) summary.facets.source = source.pairs;
  }

  const pinned = pinnedPaths(ast);
  let tried = 0;
  let kept = 0;
  for (const candidate of candidatesFrom(census, 'actions', pinned)) {
    if (tried >= CANDIDATE_BUDGET || kept >= FACET_MAX) break;
    tried += 1;
    let plan: GroupPlan;
    try {
      plan = compilePath('actions', candidate.path.split('.'), where.selfId);
    } catch {
      continue;
    }
    const facet = facetOf(sqlite, plan, where, 'count', FACET_TOP);
    // A breakdown is informative when it actually groups: more than one value,
    // fewer groups than rows.
    if (facet.distinct > 1 && facet.distinct < facet.total) {
      summary.facets[candidate.path] = facet.pairs;
      kept += 1;
    }
  }
  return summary;
}

export function summarizeEntities(
  sqlite: SqliteDriver,
  ast: ConstraintNode[],
  options: { similar?: SimilarResolutions } = {}
): QuerySummary {
  const where = compileEntityWhere(sqlite, ast, options);
  const total = (
    sqlite
      .prepare(`SELECT COUNT(*) AS c FROM entities e WHERE ${where.where}`)
      .get(...where.params) as {
      c: number;
    }
  ).c;
  const census: Record<string, number> = {};
  const rows = sqlite
    .prepare(
      `SELECT p.predicate AS predicate, COUNT(DISTINCT p.cached_entity_id) AS n FROM properties p` +
        ` WHERE p.cached_period_to IS NULL AND p.agent_sourced_id IS NULL` +
        ` AND p.cached_entity_id IN (SELECT e.id FROM entities e WHERE ${where.where}) GROUP BY 1 ORDER BY 1`
    )
    .all(...where.params) as Array<{ predicate: string; n: number }>;
  for (const r of rows) census[r.predicate === 'attachmentCid' ? 'attachment' : r.predicate] = r.n;
  const summary: QuerySummary = { total, facets: {}, census };
  if (total <= 1) return summary;

  const type = facetOf(
    sqlite,
    columnPlan('entities e JOIN entity_types et ON et.entity_id = e.id', 'et.type'),
    where,
    'count',
    FACET_TOP
  );
  if (type.distinct > 1) summary.facets.type = type.pairs;
  const source = facetOf(
    sqlite,
    columnPlan('entities e JOIN sourced_entities se ON se.entity_id = e.id', 'se.source'),
    where,
    'count',
    FACET_TOP
  );
  if (source.distinct > 1) summary.facets.source = source.pairs;

  const pinned = pinnedPaths(ast);
  let tried = 0;
  let kept = 0;
  for (const candidate of candidatesFrom(census, 'entities', pinned)) {
    if (tried >= CANDIDATE_BUDGET || kept >= FACET_MAX) break;
    tried += 1;
    let plan: GroupPlan;
    try {
      plan = compilePath('entities', candidate.path.split('.'), where.selfId);
    } catch {
      continue;
    }
    const facet = facetOf(sqlite, plan, where, 'count', FACET_TOP);
    if (facet.distinct > 1 && facet.distinct < facet.total) {
      summary.facets[candidate.path] = facet.pairs;
      kept += 1;
    }
  }
  return summary;
}
