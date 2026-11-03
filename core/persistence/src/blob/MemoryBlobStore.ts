import type { BlobStore } from './BlobStore.js';

/**
 * Map-backed blob store; the default for `:memory:` databases so blob
 * persistence always matches database persistence.
 */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async put(cid: string, bytes: Uint8Array, _mimeType?: string | null): Promise<void> {
    if (!this.blobs.has(cid)) this.blobs.set(cid, bytes);
  }

  async has(cid: string): Promise<boolean> {
    return this.blobs.has(cid);
  }

  async get(cid: string): Promise<Uint8Array> {
    const bytes = this.blobs.get(cid);
    if (!bytes) throw new Error(`Blob not found: ${cid}`);
    return bytes;
  }

  async list(): Promise<Array<{ cid: string; sizeBytes: number }>> {
    return [...this.blobs].map(([cid, bytes]) => ({ cid, sizeBytes: bytes.byteLength }));
  }

  async delete(cid: string): Promise<void> {
    this.blobs.delete(cid);
  }

  get size(): number {
    return this.blobs.size;
  }
}
