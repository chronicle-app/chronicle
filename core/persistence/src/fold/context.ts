import { sql } from '../db/sql.js';
import type { Tx } from '../db/driver.js';
import { makeDictCaches } from './dictionaries.js';
import type { DictCaches } from './dictionaries.js';
import type { FoldTrace, FoldTraceSink } from './trace.js';

/** Placement key of a observation row (the leading sort dimensions of a chain). */
export interface PlacementKey {
  validAt: number;
  observedAt: number;
}

/**
 * Dirty-state for one ordinary chain (subject sourced entity, predicate)
 * accumulated across a fold batch. Tracks whether every new row landed at a
 * strictly greater `valid_at` than the chain's pre-batch maximum (and each
 * other) — the condition for the O(1) in-order fast path. Anything tied or
 * out of order falls back to the full rebuild, which is where the
 * equal-placement tie semantics (content tiebreaks, confirmation-beats-marker)
 * live.
 */
export class DirtyChain {
  readonly subjectId: number;
  readonly predicate: string;
  /** Pre-batch placement maximum (null = chain was empty). */
  readonly preMax: PlacementKey | null;
  /** New rows actually inserted this batch, in arrival order. */
  readonly newRows: PlacementKey[] = [];
  /** True when fast-path preconditions broke (out-of-order or tied arrival). */
  outOfOrder = false;
  /**
   * True when an anchor Action's occurrence register narrowed this batch, so the
   * chain must fully recompute to re-derive its boundaries even though no observation
   * row of its own landed. Forces the full path over both the
   * "unchanged" early-out and the O(1) fast path.
   */
  invalidated = false;

  constructor(subjectId: number, predicate: string, preMax: PlacementKey | null) {
    this.subjectId = subjectId;
    this.predicate = predicate;
    this.preMax = preMax;
  }

  recordNewRow(key: PlacementKey): void {
    const prev = this.newRows.at(-1) ?? this.preMax;
    if (prev !== null && prev !== undefined && key.validAt <= prev.validAt) {
      this.outOfOrder = true;
    }
    this.newRows.push(key);
  }
}

/**
 * Mutable state for one fold batch: interning caches plus the dirty sets the
 * pipeline phases consume. Scoped to a single transaction.
 */
export class FoldContext {
  readonly caches: DictCaches = makeDictCaches();
  readonly dirtyChains = new Map<string, DirtyChain>();
  readonly dirtySpecial = new Map<
    string,
    { objectSourcedId: number; predicate: string; agentSourcedId: number | null }
  >();

  readonly touchedEntities = new Set<number>();
  /** Allow the O(1) in-order maintenance path (tests interleave this off). */
  readonly fastPath: boolean;
  /** Optional trace sink; undefined = no tracing (the `trace` call no-ops). */
  private readonly sink?: FoldTraceSink;

  constructor(opts: { fastPath?: boolean; onTrace?: FoldTraceSink } = {}) {
    this.fastPath = opts.fastPath ?? true;
    this.sink = opts.onTrace;
  }

  /** True when a sink is attached — guards the few emits needing an extra read. */
  get tracing(): boolean {
    return this.sink !== undefined;
  }

  /** Emit a trace event. No-op when no sink is attached. */
  trace(event: FoldTrace): void {
    this.sink?.(event);
  }

  /**
   * The dirty record for a chain, capturing the chain's pre-batch placement
   * maximum on first touch (before any of this batch's rows are inserted).
   */
  dirtyChain(tx: Tx, subjectId: number, predicate: string): DirtyChain {
    const key = `${subjectId}|${predicate}`;
    let chain = this.dirtyChains.get(key);
    if (!chain) {
      const row = tx.all<{ validAt: number; observedAt: number }>(sql`
        SELECT valid_at AS validAt, observed_at AS observedAt FROM observations
        WHERE subject_id = ${subjectId} AND predicate = ${predicate}
        ORDER BY valid_at DESC, observed_at DESC LIMIT 1
      `)[0];
      chain = new DirtyChain(subjectId, predicate, row ?? null);
      this.dirtyChains.set(key, chain);
    }
    return chain;
  }

  dirtySpecialChain(
    objectSourcedId: number,
    predicate: string,
    agentSourcedId: number | null
  ): void {
    const key = `${objectSourcedId}|${predicate}|${agentSourcedId ?? ''}`;
    if (!this.dirtySpecial.has(key)) {
      this.dirtySpecial.set(key, { objectSourcedId, predicate, agentSourcedId });
    }
  }
}
