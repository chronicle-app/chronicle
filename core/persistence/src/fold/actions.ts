import { eq } from 'drizzle-orm';
import type { Db } from '../db/open.js';
import { actions, assertions } from '../db/schema.js';
import { KIND_RANK, type AssertionKind } from '../assertionKind.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface UpsertActionInput {
  key: string;
  /** dedupe keyset preimage, or null when identity arrived pre-derived as `@id` */
  keyset: Record<string, unknown> | null;
  /** the founding candidate's kind — the tie rank below `assertedAt` in founding */
  kind: AssertionKind;
  type: string;
  source: string;
  sourceId: string | null;
  assertedAt: number;
  startTime: number | null;
  endTime: number | null;
  /** occurrence-range bounds from this event (NULL = no occurrence time) */
  timeEarliest: number | null;
  timeLatest: number | null;
  /** fold-materialised (content-keyed) rather than source-given */
  synthetic: boolean;
  assertionCid: string;
  agentSourcedId: number | null;
  agentEntityId: number | null;
  objectSourcedId: number | null;
  objectEntityId: number | null;
  locationLocationId: number | null;
  resultSourcedId: number | null;
  resultEntityId: number | null;
  instrumentSourcedId: number | null;
  instrumentEntityId: number | null;
  targetSourcedId: number | null;
  targetEntityId: number | null;
}

/**
 * Upsert an action by its keyset hash. Action content is fully immutable, but
 * several events can share one keyset (heartbeats, re-crawls); the row projects
 * the FOUNDING payload, elected deterministically as the event with the
 * smallest (asserted_at, cid) — plain INSERT OR IGNORE would make the row
 * depend on arrival order. A losing duplicate writes nothing (merges keep the
 * role-slot entity caches current independently) — except the two registers
 * every key-sharing event contributes to: the occurrence range (below) and
 * `end_time`, a max-wins register with NULL identity. The latter is
 * how an OPEN action closes: a direct source emits the span with `startTime` and no
 * `endTime` (founding, in-progress), heartbeats re-assert it unchanged, and the
 * close event contributes the `endTime` — later evidence updating a register,
 * never a founding re-election.
 *
 * Returns the action id and whether this call NARROWED the occurrence register
 * (`rangeChanged`) — the signal the caller uses to invalidate runs whose
 * boundaries derive through this anchor, so they re-sharpen in the same batch.
 * A brand-new action never narrows (there is no prior evidence).
 */
export function upsertAction(
  tx: Tx,
  input: UpsertActionInput
): { id: number; rangeChanged: boolean } {
  const existing = tx
    .select({
      id: actions.id,
      // The founding assertion's OWN stamp and kind — the election keys below.
      // Read through the join, NOT `actions.asserted_at`: that column is the
      // observed anchor (earliest sighting, which `reconcileObservedAnchor` may
      // lower below the founding stamp when a re-crawl confirm predates the
      // founding assert), so it can no longer serve as the election key without
      // making founding depend on arrival order. Join is FK-safe.
      foundingAssertedAt: assertions.assertedAt,
      foundingAssertionCid: actions.foundingAssertionCid,
      foundingKind: assertions.kind,
      timeEarliest: actions.timeEarliest,
      timeLatest: actions.timeLatest,
      endTime: actions.endTime,
    })
    .from(actions)
    .innerJoin(assertions, eq(assertions.cid, actions.foundingAssertionCid))
    .where(eq(actions.key, input.key))
    .get();

  const payloadColumns = {
    type: input.type,
    source: input.source,
    sourceId: input.sourceId,
    assertedAt: input.assertedAt,
    startTime: input.startTime,
    endTime: input.endTime,
    synthetic: input.synthetic,
    foundingAssertionCid: input.assertionCid,
    agentSourcedId: input.agentSourcedId,
    agentEntityId: input.agentEntityId,
    objectSourcedId: input.objectSourcedId,
    objectEntityId: input.objectEntityId,
    locationLocationId: input.locationLocationId,
    resultSourcedId: input.resultSourcedId,
    resultEntityId: input.resultEntityId,
    instrumentSourcedId: input.instrumentSourcedId,
    instrumentEntityId: input.instrumentEntityId,
    targetSourcedId: input.targetSourcedId,
    targetEntityId: input.targetEntityId,
  };

  if (!existing) {
    const { id } = tx
      .insert(actions)
      .values({
        key: input.key,
        keyset: input.keyset,
        ...payloadColumns,
        timeEarliest: input.timeEarliest,
        timeLatest: input.timeLatest,
      })
      .returning({ id: actions.id })
      .get();
    return { id, rangeChanged: false };
  }

  // Occurrence range is a min/max-wins register, narrowed independently of
  // founding election: every event sharing the key contributes its precision,
  // so a later finer date sharpens the bound regardless of arrival order.
  // NULL is the identity element (no occurrence claim). An inverted result
  // (earliest > latest) is a genuine conflict, left visible rather than coerced.
  const mergedEarliest = maxBound(existing.timeEarliest, input.timeEarliest);
  const mergedLatest = minBound(existing.timeLatest, input.timeLatest);
  const rangeChanged =
    mergedEarliest !== existing.timeEarliest || mergedLatest !== existing.timeLatest;

  // `end_time` is a max-wins register: any key-sharing event may
  // contribute one, and the latest end wins regardless of arrival order — the
  // close of an open span. NULL is the identity (no claim), never a clamp.
  const mergedEndTime = maxBound(existing.endTime, input.endTime);
  const endTimeChanged = mergedEndTime !== existing.endTime;

  // Founding order is the fold's total order `(asserted_at, kind rank, cid)`.
  // The kind rank matters for exactly one case: a `restated` Assertion honestly
  // ties its original at the same true time — the `assert` must win so a
  // re-import never repoints founding (source, founding CID, role caches).
  const incomingRank = KIND_RANK[input.kind];
  const existingRank = KIND_RANK[existing.foundingKind as AssertionKind];
  const incomingWins =
    input.assertedAt < existing.foundingAssertedAt ||
    (input.assertedAt === existing.foundingAssertedAt &&
      (incomingRank < existingRank ||
        (incomingRank === existingRank && input.assertionCid < existing.foundingAssertionCid)));

  if (incomingWins) {
    // Founding election governs the point fields; the registers still merge.
    tx.update(actions)
      .set({
        ...payloadColumns,
        endTime: mergedEndTime,
        timeEarliest: mergedEarliest,
        timeLatest: mergedLatest,
      })
      .where(eq(actions.id, existing.id))
      .run();
  } else if (rangeChanged || endTimeChanged) {
    tx.update(actions)
      .set({ endTime: mergedEndTime, timeEarliest: mergedEarliest, timeLatest: mergedLatest })
      .where(eq(actions.id, existing.id))
      .run();
  }
  return { id: existing.id, rangeChanged };
}

/** MAX-wins merge (lower bounds, end times), NULL as "no claim" (identity). */
function maxBound(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** MIN of two upper bounds, treating NULL as "no claim" (identity element). */
function minBound(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}
