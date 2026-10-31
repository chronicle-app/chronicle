import { sql } from './db/sql.js';
import type { Db } from './db/open.js';
import type { BlobStore } from './blob/BlobStore.js';
import { ingest, ValidationError } from './ingest/ingest.js';
import type { IngestResult } from './ingest/ingest.js';
import type { ContentReader } from './ingest/attachments.js';
import { foldAssertions } from './fold/fold.js';
import type { FoldTraceSink } from './fold/trace.js';
import { assertionSourceSql } from './db/assertionSource.js';

export interface ProcessOptions {
  ingestedAt?: number;
  /** Required for payloads carrying contentData; their bytes land here. */
  blobs?: BlobStore;
  /** Reader for `contentPath` inputs; Node callers pass `fs/promises` readFile. */
  readFile?: ContentReader;
  /** Allow the O(1) in-order fold path (default true; tests interleave). */
  fastPath?: boolean;
  /** Optional trace sink observing the ingest gate + the ensuing fold. */
  onTrace?: FoldTraceSink;
}

/** Fold batch size when a caller states none: `chronicle import`'s default. */
export const DEFAULT_FOLD_BATCH = 200;

/**
 * Emit the `ingest` gate verdict for a just-ingested result. Reads the landed
 * assertion row for its kind/target and the source off its stored body (a
 * minted confirm names a claim and carries no source of its own, so it reports
 * an empty one); classifies the gate from `isNew` plus the kind (a minted
 * confirm is `isNew` with kind `confirm`).
 */
function traceIngest(db: Db, result: IngestResult, onTrace: FoldTraceSink): void {
  const row = db.get<{ kind: string; source: string; targetKey: string | null }>(sql`
    SELECT a.kind AS kind, COALESCE(${sql.raw(assertionSourceSql('p.body'))}, '') AS source,
           a.target_key AS targetKey
    FROM assertions a JOIN assertion_payloads p ON p.cid = a.cid
    WHERE a.cid = ${result.cid}
  `);
  if (!row) return;
  const gate = result.isNew ? (row.kind === 'confirm' ? 'confirm' : 'new') : 'duplicate';
  onTrace({
    phase: 'ingest',
    cid: result.cid,
    kind: row.kind,
    source: row.source,
    targetKey: row.targetKey,
    gate,
  });
}

/**
 * The ingest half of {@link processEvent}: validate → CID → append to the log
 * (plus the ingest-gate trace), with NO fold. A caller that batches folds
 * ({@link FoldBatcher}, the inbox drain) uses this and folds the accumulated
 * cids once per batch — every touched chain is then recomputed once per batch
 * instead of once per event.
 */
export async function ingestEvent(
  db: Db,
  payload: unknown,
  opts?: ProcessOptions
): Promise<IngestResult> {
  const result = await ingest(db, payload, opts);
  if (opts?.onTrace) traceIngest(db, result, opts.onTrace);
  return result;
}

export interface FoldBatcherOptions extends Pick<ProcessOptions, 'fastPath' | 'onTrace'> {
  /** Cids per fold (default {@link DEFAULT_FOLD_BATCH}); `Infinity` folds once at flush. */
  batchSize?: number;
  /** Observes each fold as it commits (the cids it covered). */
  onFold?: (cids: string[]) => void;
}

/**
 * Accumulate ingested cids and fold them in bounded batches. A batch is one
 * `foldAssertions` call — one immediate transaction — so the write lock is
 * held for one batch's worth of shredding and chain recomputes, never for a
 * whole import. `flush()` folds whatever is pending; callers flush at the end
 * of a run and on the error path, so an ingested assertion is never left
 * unfolded by a clean exit.
 */
export class FoldBatcher {
  private cids: string[] = [];
  private readonly batchSize: number;
  /** Folds committed so far. */
  public folds = 0;

  constructor(
    private readonly db: Db,
    private readonly opts: FoldBatcherOptions = {}
  ) {
    this.batchSize = Math.max(1, opts.batchSize ?? DEFAULT_FOLD_BATCH);
  }

  /** Cids ingested but not yet folded. */
  get pending(): number {
    return this.cids.length;
  }

  add(cid: string): void {
    this.cids.push(cid);
    if (this.cids.length >= this.batchSize) this.flush();
  }

  /** Fold every pending cid now. Returns how many were folded. */
  flush(): number {
    if (this.cids.length === 0) return 0;
    const batch = this.cids;
    this.cids = [];
    foldAssertions(this.db, batch, { fastPath: this.opts.fastPath, onTrace: this.opts.onTrace });
    this.folds += 1;
    this.opts.onFold?.(batch);
    return batch.length;
  }
}

/** What became of one payload in a batch. */
export type PayloadOutcome =
  { ok: true; result: IngestResult } | { ok: false; error: ValidationError };

export interface ProcessEventBatchOptions extends ProcessOptions {
  /** Cids per fold (default {@link DEFAULT_FOLD_BATCH}). */
  batchSize?: number;
  /** Per-payload outcome, in input order; a `ValidationError` is captured, not thrown. */
  onOutcome?: (outcome: PayloadOutcome, index: number) => void;
}

export interface ProcessEventBatchResult {
  /** Payloads that minted a new assertion (or a new confirm). */
  created: number;
  /** Payloads whose assertion was already present. */
  duplicate: number;
  /** Payloads rejected by validation (reported through `onOutcome`). */
  failed: number;
  /** New attachment blobs stored, and their bytes. */
  attachmentsStored: number;
  attachmentBytes: number;
  /** Fold transactions committed. */
  folds: number;
}

/**
 * Ingest a stream of payloads and fold them in bounded batches — the file /
 * stdin import path. A malformed payload is captured per row (a real-data
 * batch is never aborted by one bad record); any other error — a store that
 * stays locked, a blob store failure — flushes what was already ingested and
 * then propagates, so the caller exits non-zero with the store consistent up
 * to the last completed fold.
 */
export async function processEventBatch(
  db: Db,
  payloads: unknown[],
  opts: ProcessEventBatchOptions = {}
): Promise<ProcessEventBatchResult> {
  const batcher = new FoldBatcher(db, {
    batchSize: opts.batchSize,
    fastPath: opts.fastPath,
    onTrace: opts.onTrace,
  });
  const result: ProcessEventBatchResult = {
    created: 0,
    duplicate: 0,
    failed: 0,
    attachmentsStored: 0,
    attachmentBytes: 0,
    folds: 0,
  };
  try {
    for (const [index, payload] of payloads.entries()) {
      let ingested: IngestResult;
      try {
        ingested = await ingestEvent(db, payload, opts);
      } catch (error) {
        if (error instanceof ValidationError) {
          result.failed += 1;
          opts.onOutcome?.({ ok: false, error }, index);
          continue;
        }
        throw error;
      }
      if (ingested.isNew) result.created += 1;
      else result.duplicate += 1;
      for (const a of ingested.attachments) {
        if (a.isNew) {
          result.attachmentsStored += 1;
          result.attachmentBytes += a.sizeBytes;
        }
      }
      batcher.add(ingested.cid);
      opts.onOutcome?.({ ok: true, result: ingested }, index);
    }
    batcher.flush();
  } catch (error) {
    // Best effort: fold what already landed, but never let a second failure
    // here (the same lock, most likely) mask the one that stopped the run.
    try {
      batcher.flush();
    } catch {
      // reported through the original error
    }
    throw error;
  }
  result.folds = batcher.folds;
  return result;
}

/**
 * Ingest a JSON-LD action payload (Layer 1) and fold it into derived state.
 * The single entry point for getting one event into the system. Idempotent:
 * re-processing the same payload is a no-op.
 */
export async function processEvent(
  db: Db,
  payload: unknown,
  opts?: ProcessOptions
): Promise<IngestResult> {
  const result = await ingestEvent(db, payload, opts);
  foldAssertions(db, [result.cid], { fastPath: opts?.fastPath, onTrace: opts?.onTrace });
  return result;
}

/**
 * Process many payloads as one fold batch: ingest each, then fold once with
 * dirty-chain batching (each touched chain recomputed once at commit). Order
 * does not affect projected content.
 */
export async function processEvents(
  db: Db,
  payloads: unknown[],
  opts?: ProcessOptions
): Promise<void> {
  const cids: string[] = [];
  for (const payload of payloads) {
    const result = await ingestEvent(db, payload, opts);
    cids.push(result.cid);
  }
  foldAssertions(db, cids, { fastPath: opts?.fastPath, onTrace: opts?.onTrace });
}
