import { sql } from '../db/sql.js';
import type { Tx } from '../db/driver.js';
import {
  GRADE_ORIGIN,
  getSpecialPropertyDef,
  getSpecialPropertyDefs,
} from '../annotations/actionTypes.js';
import { internVal } from './dictionaries.js';
import { diffRuns } from './runs.js';
import type { Run } from './runs.js';
import type { FoldContext } from './context.js';

interface ActionScanRow {
  id: number;
  key: string;
  type: string;
  /** when the source vouched (the sighting / error bar) */
  assertedAt: number;
  /** when the action happened (placement) = COALESCE(time_earliest, asserted_at) */
  occurredAt: number;
  /**
   * The occurrence lower bound. NULL when the opener is a state observation (a
   * subscriber-list follow with no date): the run opens with an UNKNOWN start,
   * upper-bounded by the sighting — "by then", never "at then".
   */
  timeEarliest: number | null;
  /**
   * Latest SIGHTING of any `assert` claim targeting this action — MAX over the
   * assert(s) and their confirms (decision B: restated-sourced claims stay
   * inert), or NULL if the action has no assert claim. The assert's own stamp
   * must count here because `asserted_at` on the row is now the EARLIEST sighting
   * (reconciled across re-crawls), so it no longer holds the founding
   * assert's time; recency reads the newest sighting straight from the log.
   */
  confirmedAt: number | null;
}

/**
 * Recompute one special-property chain (object's sourced entity, predicate,
 * agent). The substrate is an action scan — the actions table is already the
 * record for these. Openers open or extend a presence run; closers close it.
 * Action times are origin-grade: the action IS the event, so run starts are
 * known, and "when did I first encounter X" is MIN(cached_period_from) on indexed
 * columns.
 */
export function recomputeSpecialChain(
  tx: Tx,
  ctx: FoldContext,
  objectSourcedId: number,
  predicate: string,
  agentSourcedId: number | null
): void {
  const def = getSpecialPropertyDef(predicate);
  if (!def) return;

  const types = [...new Set([...def.openers, ...def.closers])];
  const agentFilter =
    agentSourcedId === null
      ? sql`a.agent_sourced_id IS NULL`
      : sql`a.agent_sourced_id = ${agentSourcedId}`;
  const rows = tx.all<ActionScanRow>(sql`
    SELECT a.id AS id, a.key AS key, a.type AS type, a.asserted_at AS assertedAt,
           a.occurred_at AS occurredAt, a.time_earliest AS timeEarliest,
           -- Recency (decision A): the newest sighting of any assert claim
           -- targeting this action — MAX over the assert(s) and their confirms.
           -- target_key ties an assert to its action; a confirm shares its
           -- claim_cid. The assert's own stamp is included: asserted_at on the
           -- row is the EARLIEST sighting (reconciled across re-crawls), so the
           -- founding assert's time survives only here (decision B keeps restated
           -- inert via the kind filter).
           (SELECT MAX(s.asserted_at)
              FROM assertions ta
              JOIN assertions s ON s.claim_cid = ta.claim_cid
                                AND s.kind IN ('assert', 'confirm')
             WHERE ta.target_key = a.key AND ta.kind = 'assert') AS confirmedAt
    FROM actions a
    WHERE a.object_sourced_id = ${objectSourcedId} AND ${agentFilter}
      AND a.type IN (${sql.join(
        types.map(t => sql`${t}`),
        sql`, `
      )})
  `);

  // Deterministic order: by when it occurred, then the sighting, then the action
  // content key (never local ids).
  rows.sort(
    (a, b) =>
      a.occurredAt - b.occurredAt ||
      a.assertedAt - b.assertedAt ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );

  const valueId = internVal(tx, ctx.caches, true);
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const row of rows) {
    // Placement (valid_at / period bounds) = when it occurred; the sighting
    // (observed_at) stays asserted_at as the error bar — the two only coincide
    // when the action carries no distinct occurrence time.
    const ref = { validAt: row.occurredAt, observedAt: row.assertedAt, actionId: row.id };
    const confirmed = row.confirmedAt ?? 0;
    if (def.openers.has(row.type)) {
      if (current) {
        current.last = ref;
        if (confirmed > current.confirmedObservedAt) current.confirmedObservedAt = confirmed;
      } else {
        current = {
          valueId,
          valueSourcedId: null,
          valueLocationId: null,
          objectEntityId: null,
          first: ref,
          last: ref,
          closing: null,
          // The run's start is the occurrence lower bound: the action's date when
          // it has one, else NULL — a state observation opens with an unknown
          // start, upper-bounded by the sighting (`first`), never placed AT the
          // crawl. `validAt`/`occurred_at` keep the sighting for order.
          // This is also what makes a status opener (a bare ConsumeAction for
          // "currently reading") safe to close: with no start, a later closer
          // bounds the run at (NULL, completion) and asserts no span.
          periodFrom: row.timeEarliest,
          periodTo: null,
          originatorActionId: null, // reactions (liked/follows) aren't lifecycle occurrences
          grade: GRADE_ORIGIN,
          // Confirm-extended recency: the newest confirm of any opener action in
          // this run (decision A extends only the observed axis, applied below).
          confirmedObservedAt: confirmed,
        };
      }
    } else if (current) {
      current.closing = ref;
      current.periodTo = ref.validAt;
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);

  // Confirmation extension (decision A), mirroring computeRuns: a confirm raises
  // only the run's observed axis. Reassign `last` (never mutate) — for a
  // single-opener run `first` and `last` are the same object, and first_observed
  // must not move.
  for (const run of runs) {
    if (run.confirmedObservedAt > run.last.observedAt) {
      run.last = { ...run.last, observedAt: run.confirmedObservedAt };
    }
  }

  const meta = tx.all<{ entityId: number; agentEntityId: number | null }>(sql`
    SELECT se.entity_id AS entityId,
           (SELECT entity_id FROM sourced_entities WHERE id = ${agentSourcedId}) AS agentEntityId
    FROM sourced_entities se WHERE se.id = ${objectSourcedId}
  `)[0];
  if (!meta) return;

  diffRuns(
    tx,
    {
      sourcedEntityId: objectSourcedId,
      predicate,
      agentSourcedId,
      agentEntityId: meta.agentEntityId,
    },
    meta.entityId,
    runs
  );
}

/**
 * Every special chain implied by the current actions table — used by full
 * replay. Yields (objectSourcedId, predicate, agentSourcedId) triples.
 */
export function allSpecialChains(
  tx: Tx
): Array<{ objectSourcedId: number; predicate: string; agentSourcedId: number | null }> {
  const out: Array<{ objectSourcedId: number; predicate: string; agentSourcedId: number | null }> =
    [];
  for (const def of getSpecialPropertyDefs()) {
    const types = [...new Set([...def.openers, ...def.closers])];
    const rows = tx.all<{ objectSourcedId: number; agentSourcedId: number | null }>(sql`
      SELECT DISTINCT a.object_sourced_id AS objectSourcedId, a.agent_sourced_id AS agentSourcedId
      FROM actions a
      WHERE a.object_sourced_id IS NOT NULL
        AND a.type IN (${sql.join(
          types.map(t => sql`${t}`),
          sql`, `
        )})
    `);
    for (const r of rows) {
      out.push({
        objectSourcedId: r.objectSourcedId,
        predicate: def.predicate,
        agentSourcedId: r.agentSourcedId,
      });
    }
  }
  return out;
}
