import { sql } from 'drizzle-orm';
import type { Db } from '../db/open.js';
import type { Tx } from '../db/driver.js';
import { DERIVED_TABLES } from '../db/migrate.js';
import { runImmediate } from '../db/retry.js';
import { FoldContext } from './context.js';
import { shredAssertion } from './shred.js';
import { recomputeChain } from './runs.js';
import { allSpecialChains, recomputeSpecialChain } from './special.js';
import { electEntity, electSourcedIdentifiers } from './elect.js';
import { updateEntityFts } from './search.js';
import type { FoldTraceSink } from './trace.js';

export interface FoldOptions {
  /** Allow the O(1) in-order maintenance path (default true; tests interleave). */
  fastPath?: boolean;
  /** Optional trace sink for observing the fold (see `./trace.ts`). */
  onTrace?: FoldTraceSink;
}

/**
 * Fold a batch of already-ingested events into derived state, in one
 * transaction, phases in dependency order:
 *
 *   shred → runs (rebuild-then-diff per dirty chain) → special properties
 *         → elections + entity cache → FTS
 *
 * Dirty-chain batching: each touched chain is recomputed once at commit, so a
 * backfill is one sequential scan per chain, linear overall. Idempotent —
 * re-folding an already-folded event leaves every chain clean.
 */
export function foldAssertions(db: Db, cids: string[], opts: FoldOptions = {}): void {
  if (cids.length === 0) return;
  // `runImmediate`: the fold reads the journal before writing; a deferred BEGIN
  // would upgrade to the write lock mid-transaction and fail instantly (no
  // busy-timeout wait) when another connection wrote in between.
  runImmediate(db, tx => foldAssertionsInTx(tx, cids, opts));
}

/**
 * The fold proper, running inside a caller-supplied transaction. `foldAssertions`
 * wraps it in its own transaction; replication ingest (`applyRemoteBatch`)
 * calls it directly so the log inserts and the fold commit or roll back as one
 * atomic unit. Callers must pass only cids whose events are already present.
 */
export function foldAssertionsInTx(tx: Tx, cids: string[], opts: FoldOptions = {}): void {
  if (cids.length === 0) return;
  const ctx = new FoldContext(opts);
  for (const cid of cids) shredAssertion(tx, ctx, cid);

  for (const chain of ctx.dirtyChains.values()) recomputeChain(tx, ctx, chain);

  for (const s of ctx.dirtySpecial.values()) {
    recomputeSpecialChain(tx, ctx, s.objectSourcedId, s.predicate, s.agentSourcedId);
    ctx.trace({
      phase: 'special',
      object: s.objectSourcedId,
      predicate: s.predicate,
      agent: s.agentSourcedId,
    });
  }

  const electedName = (entityId: number): string | null =>
    tx.all<{ name: string | null }>(
      sql`SELECT cached_name AS name FROM entities WHERE id = ${entityId}`
    )[0]?.name ?? null;

  const nameChanged: number[] = [];
  for (const entityId of ctx.touchedEntities) {
    // Per-source identifier columns first: they read only their own runs, so
    // nothing downstream depends on the order relative to the name election.
    electSourcedIdentifiers(tx, entityId);
    const changed = electEntity(tx, entityId);
    if (changed) nameChanged.push(entityId);
    if (ctx.tracing) {
      ctx.trace({ phase: 'elect', entityId, name: electedName(entityId), changed, hop: false });
    }
  }

  // Cross-entity invalidation: when an entity's elected name changed, every
  // entity holding a property whose object is it re-renders (their caches
  // and association_text embed the name). One hop suffices — an entity's own
  // name is a function of its own chains only, so re-election cannot cascade.
  const hop = new Set<number>();
  for (const changed of nameChanged) {
    for (const row of tx.all<{ entityId: number }>(
      sql`SELECT DISTINCT cached_entity_id AS entityId FROM properties WHERE cached_object_entity_id = ${changed}`
    )) {
      hop.add(row.entityId);
    }
  }
  for (const entityId of hop) {
    const changed = electEntity(tx, entityId);
    if (ctx.tracing) {
      ctx.trace({ phase: 'elect', entityId, name: electedName(entityId), changed, hop: true });
    }
  }

  for (const entityId of new Set([...ctx.touchedEntities, ...hop])) {
    updateEntityFts(tx, entityId);
    ctx.trace({ phase: 'fts', entityId });
  }
}

/**
 * Drop all derived state and re-fold the entire log (events in ingestion
 * order; any order converges). The recovery path for schema evolution and the
 * reference path the maintenance-interleaving tests compare against.
 */
export function rebuildDerived(db: Db, opts: FoldOptions = {}): void {
  runImmediate(db, tx => {
    for (const table of DERIVED_TABLES) {
      tx.run(sql.raw(`DELETE FROM ${table}`));
    }
  });
  const cids = db.all<{ cid: string }>(sql`SELECT cid FROM assertions ORDER BY id`).map(r => r.cid);
  foldAssertions(db, cids, opts);
}

/**
 * Recompute every special-property chain implied by the actions table (used
 * after register changes; normal folds maintain them incrementally).
 */
export function rebuildSpecialProperties(db: Db, opts: FoldOptions = {}): void {
  runImmediate(db, tx => {
    const ctx = new FoldContext(opts);
    for (const s of allSpecialChains(tx)) {
      recomputeSpecialChain(tx, ctx, s.objectSourcedId, s.predicate, s.agentSourcedId);
    }
  });
}
