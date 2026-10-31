import type { Tx } from '../db/driver.js';
import { sql } from '../db/sql.js';
import { generateAssertionBodyCID } from '../cid/assertionCid.js';
import type { AssertionKind } from '../assertionKind.js';
import { deriveAssertionColumns } from './ingest.js';
import { EnvelopeError } from './envelope.js';
import type { AttachmentMeta } from './envelope.js';

/**
 * Shared receive-side machinery for the two replication entry points that write
 * the event log verbatim: {@link applyRemoteBatch} (steady-state deltas — verify
 * every envelope, then fold) and {@link appendRemoteBatch} (bootstrap Phase A —
 * sample-verify, append only, fold later in chunks). Both prepare envelopes and
 * insert the same rows; only the verification rate and whether a fold follows
 * differ, so that difference is all that lives in the two callers.
 */

/** An envelope prepared for insertion (its log columns derived from the body). */
export interface PreparedEvent {
  cid: string;
  /** The received canonical bytes, stored VERBATIM as `assertion_payloads.body`. */
  body: string;
  kind: AssertionKind;
  assertedAt: number;
  /** Body-minus-root-stamp hash; NULL target_key when the body is a `confirm`. */
  claimCid: string;
  targetKey: string | null;
  /** Attachment CIDs this body references (via `attachmentCid` nodes). */
  attachmentRefs: string[];
}

/** Deep-scan a parsed body for any raw-content key (a log invariant violation). */
function hasRawContent(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(item => hasRawContent(item));
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'contentData' || key === 'contentPath') return true;
      if (hasRawContent(value)) return true;
    }
  }
  return false;
}

/** Deep-scan a parsed body for the `attachmentCid` references it carries. */
function collectAttachmentRefs(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectAttachmentRefs(item, out);
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'attachmentCid' && typeof value === 'string') out.add(value);
      else collectAttachmentRefs(value, out);
    }
  }
}

/**
 * Prepare one envelope for insertion, deriving its log columns from the body.
 *
 * When `verifyHash` is true the CID gate is enforced: `sha256(body)` must equal
 * the declared `cid` AND re-canonicalization must be byte-identical to the
 * received text — the hash is the ONLY gate (no Zod re-validation). When false
 * (a sampled-out envelope on the bootstrap fast path) the expensive sha256 is
 * skipped and the declared cid is trusted; the cheap structural checks (kind,
 * JSON object, no raw content, a derivable assertion time) still run so a
 * malformed body never reaches the log. Throws {@link EnvelopeError} on any
 * failure so the caller can fail the whole batch.
 */
export function prepareEnvelope(
  env: { cid: string; kind: string; body: string },
  opts: { verifyHash: boolean }
): PreparedEvent {
  if (env.kind !== 'assert') {
    throw new EnvelopeError(`event ${env.cid}: kind must be 'assert' in v1`, { kind: env.kind });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(env.body);
  } catch (error) {
    throw new EnvelopeError(`event ${env.cid}: body is not valid JSON`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new EnvelopeError(`event ${env.cid}: body must be a JSON object`, { body: env.body });
  }
  const body = parsed as Record<string, unknown>;

  // Raw bytes/paths in the log are an invariant violation: replicated bodies
  // must already carry attachmentCid, never contentData/contentPath.
  if (hasRawContent(body)) {
    throw new EnvelopeError(`event ${env.cid}: body carries contentData/contentPath`, {
      cid: env.cid,
    });
  }

  // The hash gate. The received bytes are stored verbatim, so a byte-identical
  // re-canonicalization keeps `sha256(body) == cid` directly checkable forever;
  // a semantically equal but non-canonical body (reordered keys, added
  // whitespace) fails here. Skipped for sampled-out envelopes to keep hashing
  // off the initial-sync critical path (noble is ~3 MB/s on Hermes).
  if (opts.verifyHash) {
    const { cid, canonicalBody } = generateAssertionBodyCID(body);
    if (cid !== env.cid) {
      throw new EnvelopeError(`event ${env.cid}: content CID mismatch (computed ${cid})`, {
        declared: env.cid,
        computed: cid,
      });
    }
    if (canonicalBody !== env.body) {
      throw new EnvelopeError(`event ${env.cid}: body is not byte-canonical`, { cid: env.cid });
    }
  }

  // `deriveAssertionColumns` reaches into identity derivation
  // (`extractEntityIdentities` → `ownIdentities`), which throws plain `Error`s
  // (not `EnvelopeError`) for identity failures a peer's body can legitimately
  // trigger — e.g. a hash-valid, structurally sound body whose action carries
  // neither `@key` nor `@id` and no resolvable participant keyset. Replication
  // skips Zod re-validation (the hash is the only gate), so nothing upstream of
  // this rules that out. Wrap it here so every prepareEnvelope failure surfaces
  // the same way.
  let derived: ReturnType<typeof deriveAssertionColumns>;
  try {
    derived = deriveAssertionColumns(body);
  } catch (error) {
    throw new EnvelopeError(`event ${env.cid}: could not derive log columns from body`, {
      cid: env.cid,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const { kind, assertedAt, claimCid, targetKey } = derived;
  if (assertedAt === undefined) {
    // A stored assertion always carries `@assertedAt` — the origin materializes
    // an implicit-now stamp into the body before hashing. A wire body lacking one
    // is malformed (or from a peer older than that rule); reject it rather than invent a
    // witness time the author never recorded.
    throw new EnvelopeError(`event ${env.cid}: body carries no @assertedAt`, {
      cid: env.cid,
    });
  }

  const refs = new Set<string>();
  collectAttachmentRefs(body, refs);

  return {
    cid: env.cid,
    body: env.body,
    kind,
    assertedAt,
    claimCid,
    targetKey,
    attachmentRefs: [...refs],
  };
}

/**
 * The earliest observer per attachment (min by assertedAt, then cid) across the
 * batch — mirrors the fold's "first observing event wins", giving each metadata
 * row a valid, deterministic `first_observed_assertion_cid` without trusting the wire.
 * A caller that applies a batch in chunks computes this over the WHOLE batch
 * and routes each attachment to the chunk holding its first observer, so the
 * chunk-local map below finds that same observer (it is the global minimum,
 * hence the minimum of any subset containing it).
 */
export function firstObserverMap(
  prepared: PreparedEvent[]
): Map<string, { cid: string; assertedAt: number }> {
  const firstObserver = new Map<string, { cid: string; assertedAt: number }>();
  for (const ev of prepared) {
    for (const ref of ev.attachmentRefs) {
      const prev = firstObserver.get(ref);
      if (
        !prev ||
        ev.assertedAt < prev.assertedAt ||
        (ev.assertedAt === prev.assertedAt && ev.cid < prev.cid)
      ) {
        firstObserver.set(ref, { cid: ev.cid, assertedAt: ev.assertedAt });
      }
    }
  }
  return firstObserver;
}

/** What one {@link insertBatchRows} call inserted, for the caller's fold + cursor bookkeeping. */
export interface InsertedBatchRows {
  /** CIDs newly inserted this call (the fold set, empty on the append-only path). */
  cids: string[];
  /**
   * The `assertions.id`s this call inserted, ascending. A push cursor advances
   * only over a contiguous run of these starting at its current position —
   * an id in between that this call did NOT insert belongs to a concurrent
   * local writer and must stay unpushed (see `advancePushCursorInTx` in
   * `packages/sync-client`).
   */
  insertedIds: number[];
  /**
   * `MAX(assertions.id)` among the rows THIS call inserted — 0 when nothing new
   * landed (a fully-deduped batch). Deliberately NOT a snapshot of the table's
   * global `MAX(id)`: a concurrent writer (another process, or an in-process
   * ingest at an await point) can commit a genuinely local event in the gap
   * around this transaction, with an id inside this batch's range but nothing
   * to do with it. Only the ids this call itself produced are safe for a
   * caller to fold into an "already handled by this transaction" watermark —
   * see `advanceCursorsInTx` in `packages/sync-client`, which is exactly that
   * caller. Sourced via `RETURNING` (not `DriverRunResult.changes`/
   * `lastInsertRowid`), so it stays portable to expo-sqlite (see driver.ts).
   */
  maxInsertedId: number;
}

/**
 * Insert an already-prepared batch's rows in the caller's transaction:
 * `INSERT OR IGNORE` each event + its verbatim payload, then upsert attachment
 * metadata rows. Returns the CIDs newly inserted (the fold set, empty on the
 * append-only path) plus the max id among them. No fold — the caller decides
 * whether to fold now (`applyRemoteBatch`) or later in chunks
 * (`appendRemoteBatch`).
 */
export function insertBatchRows(
  tx: Tx,
  prepared: PreparedEvent[],
  attachments: AttachmentMeta[],
  ingestedAt: number
): InsertedBatchRows {
  const newlyInserted: string[] = [];
  const insertedIds: number[] = [];
  let maxInsertedId = 0;

  for (const ev of prepared) {
    const inserted = tx.get<{ id: number }>(sql`
      INSERT INTO assertions (cid, kind, claim_cid, target_key, asserted_at, ingested_at)
      VALUES (${ev.cid}, ${ev.kind}, ${ev.claimCid}, ${ev.targetKey}, ${ev.assertedAt}, ${ingestedAt})
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    if (inserted) {
      // Store the received bytes VERBATIM so sha256(body) == cid stays checkable.
      tx.run(sql`INSERT INTO assertion_payloads (cid, body) VALUES (${ev.cid}, ${ev.body})`);
      newlyInserted.push(ev.cid);
      insertedIds.push(inserted.id);
      if (inserted.id > maxInsertedId) maxInsertedId = inserted.id;
    }
  }

  // Attachment metadata. The referencing event exists by now (inserted above or
  // already present), so the first_observed_assertion_cid FK is satisfied.
  const firstObserver = firstObserverMap(prepared);
  for (const meta of attachments) {
    const observer = firstObserver.get(meta.cid);
    if (!observer) {
      const existing = tx.get(sql`SELECT cid FROM attachments WHERE cid = ${meta.cid}`);
      if (existing) continue; // already known; nothing to reconcile
      throw new EnvelopeError(`attachment ${meta.cid}: not referenced by any event in the batch`, {
        cid: meta.cid,
      });
    }
    tx.run(sql`
      INSERT INTO attachments (cid, size_bytes, mime_type, first_observed_assertion_cid, ingested_at)
      VALUES (${meta.cid}, ${meta.sizeBytes}, ${meta.mimeType}, ${observer.cid}, ${ingestedAt})
      ON CONFLICT DO NOTHING
    `);
  }

  return { cids: newlyInserted, insertedIds, maxInsertedId };
}
