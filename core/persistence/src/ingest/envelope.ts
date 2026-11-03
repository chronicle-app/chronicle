/**
 * The L1 sync envelope — the permanent, transport-independent wire format for
 * event-set replication. A batch is the unit a peer hands to
 * {@link applyRemoteBatch}: the events it holds and the metadata for any
 * attachments those events reference. Sync is event-set union, so a batch
 * carries no merge logic — the receiver verifies each envelope's content hash
 * and `INSERT OR IGNORE`s it.
 *
 * These types and the shape checks below are deliberately minimal: they guard
 * the OUTER structure only. They do NOT re-validate event bodies against the
 * Zod schema — a body already committed on a peer is truth, and its content CID
 * is the only gate that matters.
 */

/** v1 accepts only `assert`; `retract` is reserved for a future tombstone form. */
export type AssertionKind = 'assert' | 'retract';

/**
 * One event as it crosses the wire. `body` is the EXACT canonical bytes from
 * `assertion_payloads.body` — a JSON string, verbatim — so `sha256(body)` stays
 * checkable against `cid` forever. `cid` is the CIDv1 (json codec) content hash
 * that IS the event's identity.
 */
export interface AssertionEnvelope {
  cid: string;
  kind: AssertionKind;
  body: string;
}

/**
 * Attachment metadata only — the bytes travel out of band, keyed by the same
 * CID (CIDv1, raw codec). Enough to mint an `attachments` row on the receiver;
 * the referencing event supplies `first_observed_assertion_cid`.
 */
export interface AttachmentMeta {
  cid: string;
  sizeBytes: number;
  mimeType: string | null;
}

/**
 * One replication batch. `tombstones` is reserved: v1 is pure union (no
 * deletions), so it MUST be empty.
 */
export interface SyncBatch {
  events: AssertionEnvelope[];
  attachments: AttachmentMeta[];
  tombstones: unknown[];
}

/** Thrown when a batch is structurally malformed (a peer bug). */
export class EnvelopeError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertEnvelopeShape(v: unknown, index: number): asserts v is AssertionEnvelope {
  if (!isRecord(v)) {
    throw new EnvelopeError(`events[${index}] is not an object`, { value: v });
  }
  if (typeof v.cid !== 'string' || v.cid.length === 0) {
    throw new EnvelopeError(`events[${index}].cid must be a non-empty string`, { cid: v.cid });
  }
  if (typeof v.kind !== 'string') {
    throw new EnvelopeError(`events[${index}].kind must be a string`, { kind: v.kind });
  }
  if (typeof v.body !== 'string') {
    throw new EnvelopeError(`events[${index}].body must be a string`, { cid: v.cid });
  }
}

function assertAttachmentShape(v: unknown, index: number): asserts v is AttachmentMeta {
  if (!isRecord(v)) {
    throw new EnvelopeError(`attachments[${index}] is not an object`, { value: v });
  }
  if (typeof v.cid !== 'string' || v.cid.length === 0) {
    throw new EnvelopeError(`attachments[${index}].cid must be a non-empty string`, { cid: v.cid });
  }
  if (typeof v.sizeBytes !== 'number' || !Number.isInteger(v.sizeBytes) || v.sizeBytes < 0) {
    throw new EnvelopeError(`attachments[${index}].sizeBytes must be a non-negative integer`, {
      cid: v.cid,
      sizeBytes: v.sizeBytes,
    });
  }
  if (v.mimeType !== null && typeof v.mimeType !== 'string') {
    throw new EnvelopeError(`attachments[${index}].mimeType must be a string or null`, {
      cid: v.cid,
      mimeType: v.mimeType,
    });
  }
}

/**
 * Structural gate for a received batch. Verifies the outer shape (arrays,
 * envelope/attachment fields, empty tombstones) and narrows the type; content
 * verification (CID match, canonical byte-identity, kind, raw-content rejection)
 * is {@link applyRemoteBatch}'s job. Throws {@link EnvelopeError} on any
 * malformation.
 */
export function assertBatchShape(v: unknown): asserts v is SyncBatch {
  if (!isRecord(v)) {
    throw new EnvelopeError('batch is not an object', { value: v });
  }
  if (!Array.isArray(v.events)) {
    throw new EnvelopeError('batch.events must be an array', { events: v.events });
  }
  if (!Array.isArray(v.attachments)) {
    throw new EnvelopeError('batch.attachments must be an array', { attachments: v.attachments });
  }
  if (!Array.isArray(v.tombstones)) {
    throw new EnvelopeError('batch.tombstones must be an array', { tombstones: v.tombstones });
  }
  if (v.tombstones.length > 0) {
    throw new EnvelopeError('batch.tombstones must be empty in v1 (deletions are reserved)', {
      count: v.tombstones.length,
    });
  }
  for (const [i, env] of v.events.entries()) assertEnvelopeShape(env, i);
  for (const [i, att] of v.attachments.entries()) assertAttachmentShape(att, i);
}
