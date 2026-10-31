import { sql } from '../db/sql.js';
import type { Tx } from '../db/driver.js';
import { getPredicateAnnotation } from '../annotations/ontology.js';
import { GRADE_ORIGIN, isOccurrenceType } from '../annotations/actionTypes.js';
import type { DirtyChain, FoldContext } from './context.js';

interface ChainMeta {
  cardinality: 'one' | 'many';
}

interface JournalRow {
  validAt: number;
  observedAt: number;
  /** interned literal; NULL for entity-ranged values and absence markers */
  valueId: number | null;
  /** referenced sourced entity; NULL for literals and absence markers */
  valueSourcedId: number | null;
  /** interned location value; NULL for literals, entities, and markers */
  valueLocationId: number | null;
  actionId: number;
  grade: number;
  actionKey: string;
  /** the anchoring action's type — an occurrence opener becomes the run's originator */
  actionType: string;
  /** the anchoring action's current occurrence lower bound (`time_earliest`) */
  actionEarliest: number | null;
  valueKey: string;
  objectEntityId: number | null;
  /** the carrying Assertion's claim CID — the key confirms extend recency through */
  claimCid: string;
}

interface ValueCols {
  valueId: number | null;
  valueSourcedId: number | null;
  valueLocationId: number | null;
}

/** Absence sentinel / snapshot marker: a observation row carrying no value. */
const isMarker = (r: ValueCols): boolean =>
  r.valueId === null && r.valueSourcedId === null && r.valueLocationId === null;

/**
 * Local value identity of a row/run: the literal id, sourced-entity id, or
 * location-value id, disambiguated by column ('' for markers). Used for
 * grouping and positional matching within one chain — never as a cross-peer
 * ordering tiebreak (that is what the content `valueKey` is for).
 */
const valueIdent = (r: ValueCols): string => {
  if (r.valueId !== null) return `v${r.valueId}`;
  if (r.valueSourcedId !== null) return `s${r.valueSourcedId}`;
  if (r.valueLocationId !== null) return `l${r.valueLocationId}`;
  return '';
};

/** An observation reference: the three columns an anchor stores. */
interface Anchor {
  validAt: number;
  observedAt: number;
  actionId: number;
}

/** One desired run, computed in memory before reconciliation. */
export interface Run {
  valueId: number | null;
  valueSourcedId: number | null;
  valueLocationId: number | null;
  objectEntityId: number | null;
  first: Anchor;
  last: Anchor;
  closing: Anchor | null;
  periodFrom: number | null;
  periodTo: number | null;
  /** the opening action when it is an occurrence; else NULL */
  originatorActionId: number | null;
  grade: number;
  /**
   * Transient (not persisted): the latest confirm time among this run's rows'
   * claims, accumulated during the walk. After the walk, `last.observedAt` is
   * raised to it — recency advances, placement (`valid_at`/`action_id`) does not
   * (decision A). Never read by reconciliation.
   */
  confirmedObservedAt: number;
}

/** The chain a set of runs belongs to (agent dimension only for specials). */
export interface ChainScope {
  sourcedEntityId: number;
  predicate: string;
  agentSourcedId: number | null;
  agentEntityId: number | null;
}

const anchor = (r: { validAt: number; observedAt: number; actionId: number }): Anchor => ({
  validAt: r.validAt,
  observedAt: r.observedAt,
  actionId: r.actionId,
});

/**
 * Whether a run that BEGINS a chain/timeline has a known start: origin-grade
 * first evidence, or an asserted valid time (placement differs from sighting).
 * Otherwise the start is unknown (cached_period_from NULL) — first sighting is the
 * error bar, not the bound.
 */
function initialStartKnown(first: JournalRow): boolean {
  return first.grade === GRADE_ORIGIN || first.validAt !== first.observedAt;
}

/**
 * Whether an opening run's start is known. A run begun by `row` has a known
 * start when it is NOT the timeline's first run (`priorRuns > 0` — a reappearance
 * interlocked with its predecessor's close), when it carries origin/valid-time
 * evidence, OR when a completeness marker at an EARLIER placement proved the
 * value was absent then — so it began after that marker (`firstMarker < row`).
 * Only the last clause is new: a first appearance preceded by an excluding
 * snapshot marker is an *inferred* start, not an *unknown* one.
 */
function startKnown(row: JournalRow, priorRuns: number, firstMarker: number | null): boolean {
  return (
    priorRuns > 0 || initialStartKnown(row) || (firstMarker !== null && firstMarker < row.validAt)
  );
}

function chainMeta(predicate: string): ChainMeta {
  return { cardinality: getPredicateAnnotation(predicate)?.cardinality ?? 'one' };
}

function subjectEntityId(tx: Tx, sourcedEntityId: number): number {
  const row = tx.all<{ entityId: number }>(
    sql`SELECT entity_id AS entityId FROM sourced_entities WHERE id = ${sourcedEntityId}`
  )[0];
  if (!row) throw new Error(`No sourced entity ${sourcedEntityId}`);
  return row.entityId;
}

/**
 * Load a chain's observation rows with their content keys (the deterministic
 * tiebreaks) and the referenced entity cache for entity-ranged values.
 */
function loadJournal(
  tx: Tx,
  subjectId: number,
  predicate: string,
  afterValidAt?: number
): JournalRow[] {
  const placementFilter =
    afterValidAt === undefined ? sql`` : sql`AND o.valid_at > ${afterValidAt}`;

  return tx.all<JournalRow>(sql`
    SELECT
      o.valid_at         AS validAt,
      o.observed_at      AS observedAt,
      o.value_id          AS valueId,
      o.value_sourced_id  AS valueSourcedId,
      o.value_location_id AS valueLocationId,
      o.action_id         AS actionId,
      o.grade             AS grade,
      a.key               AS actionKey,
      a.type              AS actionType,
      a.time_earliest     AS actionEarliest,
      COALESCE(v.key, vse.key, lv.key, ' absence') AS valueKey,
      vse.entity_id       AS objectEntityId,
      ja.claim_cid        AS claimCid
    FROM observations o
    JOIN actions a ON a.id = o.action_id
    JOIN assertions ja ON ja.id = o.assertion_id
    LEFT JOIN vals v ON v.id = o.value_id
    LEFT JOIN sourced_entities vse ON vse.id = o.value_sourced_id
    LEFT JOIN location_values lv ON lv.id = o.value_location_id
    WHERE o.subject_id = ${subjectId} AND o.predicate = ${predicate} ${placementFilter}
  `);
}

/**
 * Latest confirmation time per claim in this chain, keyed by claim CID.
 *
 * Decision B (the origin re-import rule): only confirms whose claim resolves to a
 * `kind='assert'` assertion count — a confirm is testimony that the WORLD still
 * looks this way, and the store re-quoting itself (a `restated` claim) is not.
 * The `a.kind='assert'` filter keeps a observation row's claim in the map only when
 * that claim is an assert; a confirm of a restated claim never matches any
 * assert row and so is inert for recency (recorded in the log, but it never
 * advances `last_confirmed`). Rides the `(claim_cid, kind)` index.
 *
 * Decision A: the fold uses this only to advance `observed_at`; `valid_at` and
 * `action_id` stay pinned to the confirmed observation row (see the final pass in
 * {@link computeRuns}).
 */
function loadConfirmTimes(tx: Tx, subjectId: number, predicate: string): Map<string, number> {
  const rows = tx.all<{ claimCid: string; t: number }>(sql`
    SELECT a.claim_cid AS claimCid, MAX(c.asserted_at) AS t
    FROM observations o
    JOIN assertions a ON a.id = o.assertion_id AND a.kind = 'assert'
    JOIN assertions c ON c.claim_cid = a.claim_cid AND c.kind = 'confirm'
    WHERE o.subject_id = ${subjectId} AND o.predicate = ${predicate}
    GROUP BY a.claim_cid
  `);
  return new Map(rows.map(r => [r.claimCid, r.t]));
}

/**
 * Deterministic chain order: placement, then content tiebreaks (action key,
 * value key — never local ids). Markers sort before values at equal placement
 * so a sighted value always beats a same-placement snapshot marker.
 */
function sortRows(rows: JournalRow[]): JournalRow[] {
  return [...rows].sort(
    (a, b) =>
      a.validAt - b.validAt ||
      a.observedAt - b.observedAt ||
      Number(isMarker(b)) - Number(isMarker(a)) ||
      (a.actionKey < b.actionKey ? -1 : a.actionKey > b.actionKey ? 1 : 0) ||
      (a.valueKey < b.valueKey ? -1 : a.valueKey > b.valueKey ? 1 : 0)
  );
}

/** Value idents confirmed at each placement (for confirmation-beats-marker ties). */
function confirmationsByPlacement(rows: JournalRow[]): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();
  for (const r of rows) {
    if (isMarker(r)) continue;
    let set = map.get(r.validAt);
    if (!set) {
      set = new Set();
      map.set(r.validAt, set);
    }
    set.add(valueIdent(r));
  }
  return map;
}

/**
 * The current occurrence lower bound (`time_earliest`) of each OCCURRENCE Action
 * referenced by these observation rows — the converged register a run's boundary
 * derives through. Only occurrence Actions with a known bound are
 * included, so a key's presence means "sharpen the boundary anchored here";
 * absence leaves the frozen `valid_at` snapshot in place. The journal query
 * reads each row's action, register included, in the same transaction, so
 * the rows carry it and no second lookup is needed.
 */
function loadOccurrenceRanges(rows: JournalRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (r.actionEarliest !== null && isOccurrenceType(r.actionType)) {
      out.set(r.actionId, r.actionEarliest);
    }
  }
  return out;
}

/** The occurrence lower bound of one Action — the fast path's boundary source. */
function registerLower(tx: Tx, actionId: number): number | null {
  return (
    tx.all<{ earliest: number | null }>(
      sql`SELECT time_earliest AS earliest FROM actions WHERE id = ${actionId}`
    )[0]?.earliest ?? null
  );
}

function computeRuns(
  rows: JournalRow[],
  cardinality: 'one' | 'many',
  confirmTimes: Map<string, number>,
  ranges: Map<number, number>
): Run[] {
  const sorted = sortRows(rows);
  if (sorted.length === 0) return [];
  const confirmed = confirmationsByPlacement(sorted);

  let runs: Run[];
  if (cardinality === 'many') {
    const idents = [...new Set(sorted.filter(r => !isMarker(r)).map(r => valueIdent(r)))];
    runs = [];
    for (const ident of idents) {
      // Walk this value's confirmations merged with every marker, in global
      // order; a marker closes the open run unless the value is confirmed at
      // the marker's own placement (snapshot still shows it).
      const timeline = sorted.filter(r => valueIdent(r) === ident || isMarker(r));
      runs.push(...walkTimeline(timeline, ident, confirmed, confirmTimes));
    }
  } else {
    runs = walkSingleValued(sorted, confirmed, confirmTimes);
  }

  // Confirmation extension (decision A): a confirm advances only recency. Each
  // run's `observed_at` rises to the latest confirm of any claim it carries;
  // `valid_at`/`action_id` keep pointing at the confirmed observation row.
  for (const run of runs) {
    if (run.confirmedObservedAt > run.last.observedAt)
      run.last.observedAt = run.confirmedObservedAt;
  }

  // Boundary placement derives through the anchor: a run opened by an
  // occurrence Action reads its opening from that Action's CURRENT register
  // (time_earliest), and a run closed by one reads its close from the closer's
  // register — not the frozen valid_at snapshot the row carried at its own shred.
  // Only a known boundary is sharpened; an unknown start (NULL) stays unknown.
  for (const run of runs) {
    if (run.periodFrom !== null && run.originatorActionId !== null) {
      const lower = ranges.get(run.originatorActionId);
      if (lower !== undefined) run.periodFrom = lower;
    }
    if (run.periodTo !== null && run.closing !== null) {
      const lower = ranges.get(run.closing.actionId);
      if (lower !== undefined) run.periodTo = lower;
    }
  }
  return runs;
}

/** Cardinality-one scan: a competing value or marker closes the open run. */
function walkSingleValued(
  sorted: JournalRow[],
  confirmed: Map<number, Set<string>>,
  confirmTimes: Map<string, number>
): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let firstMarker: number | null = null; // earliest absence marker before the first run
  for (const row of sorted) {
    if (isMarker(row)) {
      if (current) {
        if (!confirmed.get(row.validAt)?.has(valueIdent(current))) {
          closeRun(current, row);
          runs.push(current);
          current = null;
        }
      } else if (runs.length === 0 && firstMarker === null) {
        firstMarker = row.validAt;
      }
      continue;
    }
    if (current && valueIdent(current) === valueIdent(row)) {
      extendRun(current, row, confirmTimes);
      continue;
    }
    if (current) {
      closeRun(current, row);
      runs.push(current);
    }
    current = openRun(row, startKnown(row, runs.length, firstMarker), confirmTimes);
  }
  if (current) runs.push(current);
  return runs;
}

/** One value's independent timeline (cardinality-many). */
function walkTimeline(
  timeline: JournalRow[],
  ident: string,
  confirmed: Map<number, Set<string>>,
  confirmTimes: Map<string, number>
): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let firstMarker: number | null = null; // earliest absence marker before the first run
  for (const row of timeline) {
    if (isMarker(row)) {
      if (current) {
        if (!confirmed.get(row.validAt)?.has(ident)) {
          closeRun(current, row);
          runs.push(current);
          current = null;
        }
      } else if (runs.length === 0 && firstMarker === null) {
        firstMarker = row.validAt;
      }
      continue;
    }
    if (current) {
      extendRun(current, row, confirmTimes);
    } else {
      current = openRun(row, startKnown(row, runs.length, firstMarker), confirmTimes);
    }
  }
  if (current) runs.push(current);
  return runs;
}

function openRun(row: JournalRow, knownStart: boolean, confirmTimes: Map<string, number>): Run {
  return {
    valueId: row.valueId,
    valueSourcedId: row.valueSourcedId,
    valueLocationId: row.valueLocationId,
    objectEntityId: row.objectEntityId,
    first: anchor(row),
    last: anchor(row),
    closing: null,
    // cached_period_from is the run's start by convention; NULL = unknown (the first
    // sighting on the anchor is then the error bar). See startKnown().
    periodFrom: knownStart ? row.validAt : null,
    periodTo: null,
    // A run opened by an agentless lifecycle occurrence (a birthPlace routed off
    // a BirthAction) records it as its originator — the explicit graph-view link.
    originatorActionId: isOccurrenceType(row.actionType) ? row.actionId : null,
    grade: row.grade,
    confirmedObservedAt: confirmTimes.get(row.claimCid) ?? 0,
  };
}

function extendRun(run: Run, row: JournalRow, confirmTimes: Map<string, number>): void {
  run.last = anchor(row);
  run.grade = Math.max(run.grade, row.grade);
  const confirmed = confirmTimes.get(row.claimCid);
  if (confirmed !== undefined && confirmed > run.confirmedObservedAt) {
    run.confirmedObservedAt = confirmed;
  }
}

function closeRun(run: Run, row: JournalRow): void {
  run.closing = anchor(row);
  run.periodTo = row.validAt;
}

// ---------------------------------------------------------------------------
// Reconciliation: rebuild-then-diff with positional matching
// ---------------------------------------------------------------------------

interface ExistingRow {
  id: number;
  entityId: number;
  valueId: number | null;
  valueSourcedId: number | null;
  valueLocationId: number | null;
  agentEntityId: number | null;
  objectEntityId: number | null;
  firstObservedValidAt: number;
  firstObservedObservedAt: number;
  firstObservedActionId: number;
  lastConfirmedValidAt: number;
  lastConfirmedObservedAt: number;
  lastConfirmedActionId: number;
  closingValidAt: number | null;
  closingObservedAt: number | null;
  closingActionId: number | null;
  periodFrom: number | null;
  periodTo: number | null;
  originatorActionId: number | null;
  grade: number;
}

/**
 * Reconcile a chain's desired runs against its existing rows by positional
 * matching: (value identity, ordinal among same-value runs in placement
 * order). Survives boundary shifts and A→B→A; row ids are best-effort stable,
 * never contractual. UPDATE on match, INSERT new, DELETE vanished.
 */
export function diffRuns(tx: Tx, scope: ChainScope, entityId: number, desired: Run[]): void {
  const agentFilter =
    scope.agentSourcedId === null
      ? sql`agent_sourced_id IS NULL`
      : sql`agent_sourced_id = ${scope.agentSourcedId}`;
  const existing = tx.all<ExistingRow>(sql`
    SELECT id, cached_entity_id AS entityId, value_id AS valueId,
           value_sourced_id AS valueSourcedId, value_location_id AS valueLocationId,
           cached_agent_entity_id AS agentEntityId, cached_object_entity_id AS objectEntityId,
           first_observed_valid_at AS firstObservedValidAt,
           first_observed_observed_at AS firstObservedObservedAt,
           first_observed_action_id AS firstObservedActionId,
           last_confirmed_valid_at AS lastConfirmedValidAt,
           last_confirmed_observed_at AS lastConfirmedObservedAt,
           last_confirmed_action_id AS lastConfirmedActionId,
           closing_valid_at AS closingValidAt,
           closing_observed_at AS closingObservedAt,
           closing_action_id AS closingActionId,
           cached_period_from AS periodFrom, cached_period_to AS periodTo,
           originator_action_id AS originatorActionId, grade AS grade
    FROM properties
    WHERE sourced_entity_id = ${scope.sourcedEntityId}
      AND predicate = ${scope.predicate} AND ${agentFilter}
    ORDER BY first_observed_valid_at, first_observed_observed_at, id
  `);

  // Positional keys: ordinal among same-value runs in placement order.
  const existingByKey = new Map<string, ExistingRow>();
  const existingOrdinals = new Map<string, number>();
  for (const row of existing) {
    const ident = valueIdent(row);
    const ordinal = existingOrdinals.get(ident) ?? 0;
    existingOrdinals.set(ident, ordinal + 1);
    existingByKey.set(`${ident}|${ordinal}`, row);
  }

  const desiredSorted = [...desired].sort(
    (a, b) => a.first.validAt - b.first.validAt || a.first.observedAt - b.first.observedAt
  );
  const desiredOrdinals = new Map<string, number>();
  const matchedIds = new Set<number>();

  for (const run of desiredSorted) {
    const ident = valueIdent(run);
    const ordinal = desiredOrdinals.get(ident) ?? 0;
    desiredOrdinals.set(ident, ordinal + 1);
    const match = existingByKey.get(`${ident}|${ordinal}`);
    if (match) {
      matchedIds.add(match.id);
      if (!runEqualsRow(run, match, entityId, scope.agentEntityId)) {
        tx.run(sql`
          UPDATE properties SET
            cached_entity_id = ${entityId},
            cached_agent_entity_id = ${scope.agentEntityId},
            cached_object_entity_id = ${run.objectEntityId},
            first_observed_valid_at = ${run.first.validAt},
            first_observed_observed_at = ${run.first.observedAt},
            first_observed_action_id = ${run.first.actionId},
            last_confirmed_valid_at = ${run.last.validAt},
            last_confirmed_observed_at = ${run.last.observedAt},
            last_confirmed_action_id = ${run.last.actionId},
            closing_valid_at = ${run.closing?.validAt ?? null},
            closing_observed_at = ${run.closing?.observedAt ?? null},
            closing_action_id = ${run.closing?.actionId ?? null},
            cached_period_from = ${run.periodFrom},
            cached_period_to = ${run.periodTo},
            originator_action_id = ${run.originatorActionId},
            grade = ${run.grade}
          WHERE id = ${match.id}
        `);
      }
    } else {
      tx.run(sql`
        INSERT INTO properties (
          sourced_entity_id, cached_entity_id, predicate, value_id, value_sourced_id, value_location_id,
          agent_sourced_id, cached_agent_entity_id, cached_object_entity_id,
          first_observed_valid_at, first_observed_observed_at, first_observed_action_id,
          last_confirmed_valid_at, last_confirmed_observed_at, last_confirmed_action_id,
          closing_valid_at, closing_observed_at, closing_action_id,
          cached_period_from, cached_period_to, originator_action_id, grade
        ) VALUES (
          ${scope.sourcedEntityId}, ${entityId}, ${scope.predicate}, ${run.valueId}, ${run.valueSourcedId}, ${run.valueLocationId},
          ${scope.agentSourcedId}, ${scope.agentEntityId}, ${run.objectEntityId},
          ${run.first.validAt}, ${run.first.observedAt}, ${run.first.actionId},
          ${run.last.validAt}, ${run.last.observedAt}, ${run.last.actionId},
          ${run.closing?.validAt ?? null}, ${run.closing?.observedAt ?? null}, ${run.closing?.actionId ?? null},
          ${run.periodFrom}, ${run.periodTo}, ${run.originatorActionId}, ${run.grade}
        )
      `);
    }
  }

  for (const row of existing) {
    if (!matchedIds.has(row.id)) {
      tx.run(sql`DELETE FROM properties WHERE id = ${row.id}`);
    }
  }
}

function runEqualsRow(
  run: Run,
  row: ExistingRow,
  entityId: number,
  agentEntityId: number | null
): boolean {
  return (
    row.entityId === entityId &&
    row.agentEntityId === agentEntityId &&
    row.objectEntityId === run.objectEntityId &&
    row.firstObservedValidAt === run.first.validAt &&
    row.firstObservedObservedAt === run.first.observedAt &&
    row.firstObservedActionId === run.first.actionId &&
    row.lastConfirmedValidAt === run.last.validAt &&
    row.lastConfirmedObservedAt === run.last.observedAt &&
    row.lastConfirmedActionId === run.last.actionId &&
    row.closingValidAt === (run.closing?.validAt ?? null) &&
    row.closingObservedAt === (run.closing?.observedAt ?? null) &&
    row.closingActionId === (run.closing?.actionId ?? null) &&
    row.periodFrom === run.periodFrom &&
    row.periodTo === run.periodTo &&
    row.originatorActionId === run.originatorActionId &&
    row.grade === run.grade
  );
}

// ---------------------------------------------------------------------------
// Chain maintenance entry points
// ---------------------------------------------------------------------------

/** Full rebuild-then-diff for one ordinary chain. */
export function rebuildChain(tx: Tx, subjectId: number, predicate: string): void {
  const meta = chainMeta(predicate);
  const rows = loadJournal(tx, subjectId, predicate);
  const runs = computeRuns(
    rows,
    meta.cardinality,
    loadConfirmTimes(tx, subjectId, predicate),
    loadOccurrenceRanges(rows)
  );
  const entityId = subjectEntityId(tx, subjectId);
  diffRuns(
    tx,
    { sourcedEntityId: subjectId, predicate, agentSourcedId: null, agentEntityId: null },
    entityId,
    runs
  );
}

/**
 * Maintain one dirty chain: the O(1) in-order fast path when every new row
 * landed strictly after the chain's previous placement maximum, else the full
 * rebuild. Both paths land on identical rows — the interleaving tests assert
 * it.
 */
export function recomputeChain(tx: Tx, ctx: FoldContext, chain: DirtyChain): void {
  const meta = chainMeta(chain.predicate);
  // Confirms extend recency without minting observation rows, so a chain dirtied by
  // a confirm alone (`newRows` empty) still has work; and a chain with confirms
  // cannot use the fast path (which only sees new observation rows, not confirm
  // times). Load them first and let their presence force the full rebuild.
  const confirmTimes = loadConfirmTimes(tx, chain.subjectId, chain.predicate);
  const traceChain = (path: 'unchanged' | 'fast' | 'full'): void =>
    ctx.trace({
      phase: 'chain',
      subject: chain.subjectId,
      predicate: chain.predicate,
      path,
      newRows: chain.newRows.length,
      confirms: confirmTimes.size,
      invalidated: chain.invalidated,
    });
  // Truly unchanged only when nothing landed AND no anchor register narrowed.
  if (chain.newRows.length === 0 && confirmTimes.size === 0 && !chain.invalidated) {
    traceChain('unchanged');
    return;
  }
  // A register narrowing re-derives boundaries the fast path would never touch,
  // so an invalidated chain always takes the full path.
  if (
    ctx.fastPath &&
    !chain.outOfOrder &&
    !chain.invalidated &&
    chain.preMax !== null &&
    confirmTimes.size === 0
  ) {
    applyInOrder(tx, chain, meta);
    traceChain('fast');
    return;
  }
  traceChain('full');
  const rows = loadJournal(tx, chain.subjectId, chain.predicate);
  const runs = computeRuns(rows, meta.cardinality, confirmTimes, loadOccurrenceRanges(rows));
  const entityId = subjectEntityId(tx, chain.subjectId);
  diffRuns(
    tx,
    {
      sourcedEntityId: chain.subjectId,
      predicate: chain.predicate,
      agentSourcedId: null,
      agentEntityId: null,
    },
    entityId,
    runs
  );
}

interface OpenRunRow {
  id: number;
  valueId: number | null;
  valueSourcedId: number | null;
  valueLocationId: number | null;
  lastConfirmedValidAt: number;
  grade: number;
}

/**
 * The in-order fast path. Preconditions (enforced by DirtyChain): the chain was
 * non-empty and every new row has a strictly greater valid_at than the previous
 * maximum and each other — so no equal-placement tie semantics apply and each
 * new row either extends the open run (bump last_confirmed), closes it, or
 * opens a new one.
 */
function applyInOrder(tx: Tx, chain: DirtyChain, meta: ChainMeta): void {
  const newRows = sortRows(
    loadJournal(tx, chain.subjectId, chain.predicate, chain.preMax!.validAt)
  );
  const entityId = subjectEntityId(tx, chain.subjectId);

  const openRuns = (): OpenRunRow[] =>
    tx.all<OpenRunRow>(sql`
      SELECT id, value_id AS valueId, value_sourced_id AS valueSourcedId,
             value_location_id AS valueLocationId,
             last_confirmed_valid_at AS lastConfirmedValidAt, grade AS grade
      FROM properties
      WHERE sourced_entity_id = ${chain.subjectId} AND predicate = ${chain.predicate}
        AND agent_sourced_id IS NULL AND cached_period_to IS NULL
    `);
  // value identity → open run row; maintained across the batch's rows.
  const open = new Map<string, OpenRunRow>();
  for (const r of openRuns()) open.set(valueIdent(r), r);

  const hasAnyRun = (ident?: string): boolean => {
    const valueFilter =
      ident === undefined
        ? sql``
        : ident.startsWith('v')
          ? sql`AND value_id = ${Number(ident.slice(1))}`
          : ident.startsWith('s')
            ? sql`AND value_sourced_id = ${Number(ident.slice(1))}`
            : sql`AND value_location_id = ${Number(ident.slice(1))}`;
    return (
      tx.all<{ one: number }>(sql`
        SELECT 1 AS one FROM properties
        WHERE sourced_entity_id = ${chain.subjectId} AND predicate = ${chain.predicate}
          AND agent_sourced_id IS NULL ${valueFilter} LIMIT 1
      `).length > 0
    );
  };

  const close = (run: OpenRunRow, row: JournalRow): void => {
    // The closing anchor (closing_valid_at) is the frozen snapshot — truth. The
    // period bound derives through it: an occurrence closer contributes its
    // current register lower, not that snapshot. Reads the register
    // live, so a same-batch narrowing is already reflected.
    const periodTo = isOccurrenceType(row.actionType)
      ? (registerLower(tx, row.actionId) ?? row.validAt)
      : row.validAt;
    tx.run(sql`
      UPDATE properties SET closing_valid_at = ${row.validAt},
        closing_observed_at = ${row.observedAt}, closing_action_id = ${row.actionId},
        cached_period_to = ${periodTo}
      WHERE id = ${run.id}
    `);
    open.delete(valueIdent(run));
  };

  const bump = (run: OpenRunRow, row: JournalRow): void => {
    tx.run(sql`
      UPDATE properties SET last_confirmed_valid_at = ${row.validAt},
        last_confirmed_observed_at = ${row.observedAt},
        last_confirmed_action_id = ${row.actionId},
        grade = MAX(grade, ${row.grade})
      WHERE id = ${run.id}
    `);
    run.lastConfirmedValidAt = row.validAt;
    run.grade = Math.max(run.grade, row.grade);
  };

  // An absence/snapshot marker on this chain at an earlier placement — proof the
  // value was absent before, so a first appearance after it has a known start.
  // The full-rebuild path reads this off the in-memory timeline (startKnown);
  // the fast path queries the store so the two agree.
  const markerBefore = (validAt: number): boolean =>
    tx.all<{ one: number }>(sql`
      SELECT 1 AS one FROM observations
      WHERE subject_id = ${chain.subjectId} AND predicate = ${chain.predicate}
        AND value_id IS NULL AND value_sourced_id IS NULL AND value_location_id IS NULL
        AND valid_at < ${validAt}
      LIMIT 1
    `).length > 0;

  const insert = (row: JournalRow, isInitial: boolean): void => {
    const knownStart = !isInitial || initialStartKnown(row) || markerBefore(row.validAt);
    // A known opening derives through the anchor: an occurrence opener contributes
    // its current register lower, not the frozen valid_at snapshot.
    let periodFrom: number | null = null;
    if (knownStart) {
      periodFrom = isOccurrenceType(row.actionType)
        ? (registerLower(tx, row.actionId) ?? row.validAt)
        : row.validAt;
    }
    // RETURNING id, not lastInsertRowid: the portable SqliteDriver run result
    // omits lastInsertRowid (expo-sqlite's sync bindings don't expose it), and
    // SQLite RETURNING is supported by both node:sqlite and expo bindings.
    const inserted = tx.get<{ id: number }>(sql`
      INSERT INTO properties (
        sourced_entity_id, cached_entity_id, predicate, value_id, value_sourced_id, value_location_id,
        agent_sourced_id, cached_agent_entity_id, cached_object_entity_id,
        first_observed_valid_at, first_observed_observed_at, first_observed_action_id,
        last_confirmed_valid_at, last_confirmed_observed_at, last_confirmed_action_id,
        closing_valid_at, closing_observed_at, closing_action_id,
        cached_period_from, cached_period_to, originator_action_id, grade
      ) VALUES (
        ${chain.subjectId}, ${entityId}, ${chain.predicate}, ${row.valueId}, ${row.valueSourcedId}, ${row.valueLocationId},
        NULL, NULL, ${row.objectEntityId},
        ${row.validAt}, ${row.observedAt}, ${row.actionId},
        ${row.validAt}, ${row.observedAt}, ${row.actionId},
        NULL, NULL, NULL,
        ${periodFrom}, NULL, ${isOccurrenceType(row.actionType) ? row.actionId : null}, ${row.grade}
      )
      RETURNING id
    `)!;
    open.set(valueIdent(row), {
      id: inserted.id,
      valueId: row.valueId,
      valueSourcedId: row.valueSourcedId,
      valueLocationId: row.valueLocationId,
      lastConfirmedValidAt: row.validAt,
      grade: row.grade,
    });
  };

  for (const row of newRows) {
    if (meta.cardinality === 'one') {
      const current = [...open.values()][0];
      if (isMarker(row)) {
        if (current) close(current, row);
      } else if (current && valueIdent(current) === valueIdent(row)) {
        bump(current, row);
      } else {
        const isInitial = !current && !hasAnyRun();
        if (current) close(current, row);
        insert(row, isInitial);
      }
    } else if (isMarker(row)) {
      // Snapshot marker: closes every timeline lacking a confirmation at
      // this placement; strictly-increasing valid_at guarantees none has one.
      for (const run of open.values()) close(run, row);
    } else {
      const current = open.get(valueIdent(row));
      if (current) {
        bump(current, row);
      } else {
        insert(row, !hasAnyRun(valueIdent(row)));
      }
    }
  }
}
