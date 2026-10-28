import { sql } from 'drizzle-orm';
import type { Db } from '../db/open.js';
import { propagatingRelationNames } from '../annotations/actionTypes.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const RELATION_NAMES = propagatingRelationNames();
const relationInList = sql.join(
  RELATION_NAMES.map(n => sql`${n}`),
  sql`, `
);

/**
 * Transitive encounter propagation — encountering a thing
 * encounters the allowlisted relation targets behind it (a track's album and
 * artist, a book's author). One hop: only the consumed object's own relations
 * are followed, never the targets'. All rows are level `encounter` and share
 * the originating action, so the direct row's delete-by-action also clears them.
 *
 * Both paths key a transitive row by `(originating_action_id, target ENTITY)` —
 * at most one row per consume per target entity, never per sourced alias — and
 * pick a deterministic representative `subject_sourced_id`: `MIN(value_sourced_id)`
 * over every propagating edge object→target in the observations table. This keeps the log
 * order-independent even when one object names a target through several sourced
 * identities that later merge into one entity (a track `inAlbum` both the Spotify
 * and the Apple album, merged via sameAs): the row count and the recorded truth
 * id are a function of the final state, not arrival order.
 */

/**
 * The deterministic representative sourced id for the object→target edge: the
 * smallest `value_sourced_id` across all propagating-relation observations from
 * the object entity to the target entity currently in the observations table. Append-only
 * observations ⇒ this only ever decreases as smaller-id aliases arrive, and both emit
 * paths converge on the global minimum once every edge has been seen. Null when
 * no such edge exists (nothing to propagate).
 */
function representativeTargetSourcedId(
  tx: Tx,
  objectEntityId: number,
  targetEntityId: number
): number | null {
  const row = tx.all<{ sourcedId: number | null }>(sql`
    SELECT MIN(o.value_sourced_id) AS sourcedId
    FROM observations o
    JOIN sourced_entities sse ON sse.id = o.subject_id
    JOIN sourced_entities tse ON tse.id = o.value_sourced_id
    WHERE sse.entity_id = ${objectEntityId}
      AND tse.entity_id = ${targetEntityId}
      AND o.predicate IN (${relationInList})
  `)[0];
  return row?.sourcedId ?? null;
}

/**
 * Path A, at consume shred: emit a transitive encounter for each allowlisted
 * relation target of the just-encountered object that is already known. Reads
 * the object's relations from the observations table (the current event's were written
 * just before this runs), so an inline `inAlbum` is picked up immediately. Runs
 * after the action's own rows were cleared (delete-by-action), so no prior
 * transitive row for this action exists yet.
 */
export function emitTransitiveEncounters(
  tx: Tx,
  args: {
    actionId: number;
    objectEntityId: number;
    encountererSourcedId: number | null;
    encountererEntityId: number | null;
    cachedTimestamp: number;
  }
): void {
  // One target per ENTITY (not per sourced alias), with the deterministic
  // MIN(value_sourced_id) representative, so duplicate aliases of one merged
  // target cannot inflate the row count.
  const targets = tx.all<{ sourcedId: number; entityId: number }>(sql`
    SELECT tse.entity_id AS entityId, MIN(o.value_sourced_id) AS sourcedId
    FROM observations o
    JOIN sourced_entities sse ON sse.id = o.subject_id
    JOIN sourced_entities tse ON tse.id = o.value_sourced_id
    WHERE sse.entity_id = ${args.objectEntityId}
      AND o.value_sourced_id IS NOT NULL
      AND o.predicate IN (${relationInList})
    GROUP BY tse.entity_id
  `);
  for (const t of targets) {
    if (t.entityId === args.objectEntityId) continue; // a self-relation is no encounter
    tx.run(sql`
      INSERT INTO encounters (
        originating_action_id, cached_timestamp,
        encounterer_sourced_id, cached_encounterer_entity_id,
        subject_sourced_id, cached_subject_entity_id, level
      ) VALUES (
        ${args.actionId}, ${args.cachedTimestamp},
        ${args.encountererSourcedId}, ${args.encountererEntityId},
        ${t.sourcedId}, ${t.entityId}, 'encounter'
      )
    `);
  }
}

/**
 * Path B, when a propagating relation edge is newly asserted on an object:
 * backfill a transitive encounter for every PRIOR direct consume of that object
 * (the edge often arrives after the listen/read). Direct = an encounter whose
 * subject IS its action's object — so transitive rows (subject ≠ object) and
 * message rows are excluded, keeping propagation to one hop. Idempotent and
 * convergent per `(action, target entity)`: a missing row is inserted; an
 * existing one is lowered to the representative sourced id when a smaller-id
 * alias has since arrived (so the result is order-independent of which edge
 * landed first).
 */
export function backfillTransitiveEncounters(
  tx: Tx,
  args: { objectEntityId: number; targetEntityId: number }
): void {
  if (args.targetEntityId === args.objectEntityId) return; // a self-relation is no encounter
  const subjectSourcedId = representativeTargetSourcedId(
    tx,
    args.objectEntityId,
    args.targetEntityId
  );
  if (subjectSourcedId === null) return; // edge not in the observations table — nothing to propagate

  const priors = tx.all<{
    actionId: number;
    ts: number;
    encSourced: number | null;
    encEntity: number | null;
  }>(sql`
    SELECT e.originating_action_id AS actionId, e.cached_timestamp AS ts,
           e.encounterer_sourced_id AS encSourced, e.cached_encounterer_entity_id AS encEntity
    FROM encounters e
    JOIN actions a ON a.id = e.originating_action_id
    WHERE e.cached_subject_entity_id = ${args.objectEntityId}
      AND e.cached_subject_entity_id = a.cached_object_entity_id
      AND e.level = 'encounter'
  `);
  for (const p of priors) {
    const existing = tx.all<{ id: number; sourcedId: number }>(sql`
      SELECT id, subject_sourced_id AS sourcedId FROM encounters
      WHERE originating_action_id = ${p.actionId}
        AND cached_subject_entity_id = ${args.targetEntityId}
      LIMIT 1
    `)[0];
    if (!existing) {
      tx.run(sql`
        INSERT INTO encounters (
          originating_action_id, cached_timestamp,
          encounterer_sourced_id, cached_encounterer_entity_id,
          subject_sourced_id, cached_subject_entity_id, level
        ) VALUES (
          ${p.actionId}, ${p.ts}, ${p.encSourced}, ${p.encEntity},
          ${subjectSourcedId}, ${args.targetEntityId}, 'encounter'
        )
      `);
    } else if (existing.sourcedId > subjectSourcedId) {
      tx.run(sql`
        UPDATE encounters SET subject_sourced_id = ${subjectSourcedId} WHERE id = ${existing.id}
      `);
    }
  }
}
