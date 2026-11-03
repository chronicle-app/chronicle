import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachmentCidOf } from './BlobStore.js';
import { LocalBlobStore } from './LocalBlobStore.js';
import { MemoryBlobStore } from './MemoryBlobStore.js';

const bytes = new TextEncoder().encode('hello attachment');

describe('attachmentCidOf', () => {
  it('mints a stable CIDv1 with the raw codec', () => {
    const cid = attachmentCidOf(bytes);
    // raw-codec CIDv1 in base32 always starts with "bafkrei"
    expect(cid).toMatch(/^bafkrei/);
    expect(attachmentCidOf(bytes)).toBe(cid);
    expect(attachmentCidOf(new TextEncoder().encode('other'))).not.toBe(cid);
  });
});

describe('LocalBlobStore', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores under sharded paths named <cid>.<ext> from the mime hint', async () => {
    dir = mkdtempSync(join(tmpdir(), 'blob-'));
    const store = new LocalBlobStore(dir);
    const cid = attachmentCidOf(bytes);

    await store.put(cid, bytes, 'image/png');

    // shard chars come from the CID tail — the bafkrei… head is constant
    expect(await store.find(cid)).toBe(join(dir, cid.slice(-4, -2), cid.slice(-2), `${cid}.png`));
    expect(await store.has(cid)).toBe(true);
    expect(Buffer.from(await store.get(cid)).toString()).toBe('hello attachment');
  });

  it('stores unsniffable bytes with unknown mimes extensionless', async () => {
    dir = mkdtempSync(join(tmpdir(), 'blob-'));
    const store = new LocalBlobStore(dir);
    const cid = attachmentCidOf(bytes);

    await store.put(cid, bytes, 'application/x-strange; charset=weird');

    expect(await store.find(cid)).toBe(join(dir, cid.slice(-4, -2), cid.slice(-2), cid));
    expect(Buffer.from(await store.get(cid)).toString()).toBe('hello attachment');
  });

  it('sniffs magic bytes when the asserted mime is unhelpful', async () => {
    dir = mkdtempSync(join(tmpdir(), 'blob-'));
    const store = new LocalBlobStore(dir);
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const cid = attachmentCidOf(jpeg);

    await store.put(cid, jpeg, 'application/octet-stream');

    expect(await store.find(cid)).toMatch(/\.jpg$/);
  });

  it('put is idempotent; the first writer wins the extension', async () => {
    dir = mkdtempSync(join(tmpdir(), 'blob-'));
    const store = new LocalBlobStore(dir);
    const cid = attachmentCidOf(bytes);

    await store.put(cid, bytes, 'image/png');
    await store.put(cid, bytes, 'image/jpeg'); // no-op: same bytes, same CID

    expect(await store.find(cid)).toMatch(/\.png$/);
    expect(await store.has('bafkreimissing')).toBe(false);
    await expect(store.get('bafkreimissing')).rejects.toThrow();
  });
});

describe('MemoryBlobStore', () => {
  it('round-trips and reports size', async () => {
    const store = new MemoryBlobStore();
    const cid = attachmentCidOf(bytes);

    expect(await store.has(cid)).toBe(false);
    await expect(store.get(cid)).rejects.toThrow('Blob not found');

    await store.put(cid, bytes);
    await store.put(cid, bytes);

    expect(await store.has(cid)).toBe(true);
    expect(store.size).toBe(1);
    expect(await store.get(cid)).toBe(bytes);
  });
});
