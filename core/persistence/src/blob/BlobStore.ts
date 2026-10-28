import { CID } from 'multiformats/cid';
import { create as createDigest } from 'multiformats/hashes/digest';
import { sha256 } from '../cid/sha256.js';

const SHA2_256 = 0x12;
const RAW_CODEC = 0x55;

/**
 * Content-addressed storage for attachment bytes. The event log never carries
 * raw binary content — ingest rewrites `contentData` into an `attachmentCid`
 * and the bytes land here, keyed by that CID. The default implementation is a
 * directory colocated with the database file; an object store is a future
 * implementation of this same interface, not a different code path.
 */
export interface BlobStore {
  /**
   * Idempotent content-addressed write. No-op when the CID is already stored.
   * The mime type is a hint a backend may use for browsability (e.g. a file
   * extension); identity is the CID and the authoritative mime lives in the
   * attachments table.
   */
  put(cid: string, bytes: Uint8Array, mimeType?: string | null): Promise<void>;
  has(cid: string): Promise<boolean>;
  /** Throws when the CID is absent. */
  get(cid: string): Promise<Uint8Array>;
  /** Every stored blob with its byte size. For garbage-collecting orphans. */
  list(): Promise<Array<{ cid: string; sizeBytes: number }>>;
  /** Idempotent delete — no-op when the CID is absent. */
  delete(cid: string): Promise<void>;
}

/**
 * CID for binary attachment content: CIDv1, raw codec, sha256 — so blobs are
 * addressable across the codebase. Distinct from event CIDs, which use the
 * JSON codec.
 */
export function attachmentCidOf(bytes: Uint8Array): string {
  const hashBytes = sha256(bytes);
  return CID.create(1, RAW_CODEC, createDigest(SHA2_256, hashBytes)).toString();
}
