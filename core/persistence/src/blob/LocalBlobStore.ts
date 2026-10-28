import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BlobStore } from './BlobStore.js';

// Extensions for browsability (Finder previews, open-with). Deliberately a
// small allowlist — arbitrary mime strings don't belong in filenames; unknown
// mimes store extensionless.
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

// Magic-byte fallback for unhelpful mimes (plugins commonly assert
// application/octet-stream). Filename-only: the asserted mime in the event
// payload and attachments table is never altered by sniffing.
function sniffExtension(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, text: string) =>
    bytes.length >= start + text.length &&
    [...text].every((ch, i) => bytes[start + i] === ch.codePointAt(0));

  if (bytes.length >= 4 && bytes[0] === 0x89 && ascii(1, 'PNG')) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpg';
  if (ascii(0, 'GIF8')) return 'gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav';
  if (ascii(4, 'ftypheic') || ascii(4, 'ftypheix') || ascii(4, 'ftypmif1')) return 'heic';
  if (ascii(4, 'ftypqt')) return 'mov';
  if (ascii(4, 'ftypM4A')) return 'm4a';
  if (ascii(4, 'ftyp')) return 'mp4';
  if (ascii(0, '%PDF')) return 'pdf';
  if (ascii(0, 'ID3')) return 'mp3';
  if (ascii(0, 'OggS')) return 'ogg';
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
    return 'ico';
  return undefined;
}

/**
 * Content-addressed blobs on the local filesystem, sharded two levels deep:
 * `xy/zw/<cid>.<ext>`. Shard characters come from the TAIL of the CID — the
 * head is a constant multibase/version/codec prefix (`bafkrei…` for every
 * raw-codec sha256 CID), so leading characters carry no entropy. The name is
 * the CID; the extension is a browsing convenience derived from the mime hint
 * (or sniffed magic bytes) at write time — first writer wins, unknown content
 * stores bare. Because the extension isn't knowable from the CID alone,
 * lookups scan the shard directory — sharding keeps those tiny. CIDs of one
 * codec/hash are fixed-length, so a `<cid>.` prefix match cannot collide
 * across CIDs. Writes are atomic (temp file + rename) and idempotent; the
 * directory is created lazily on first put.
 */
export class LocalBlobStore implements BlobStore {
  constructor(readonly dir: string) {}

  private shardDir(cid: string): string {
    return join(this.dir, cid.slice(-4, -2), cid.slice(-2));
  }

  /** On-disk path for a stored CID (`<cid>` or `<cid>.<ext>`), or null. */
  async find(cid: string): Promise<string | null> {
    let names: string[];
    try {
      names = await readdir(this.shardDir(cid));
    } catch {
      return null; // shard directory doesn't exist yet
    }
    // exclude leftovers from interrupted writes (`<cid>[.ext].tmp-…`)
    const name = names.find(n => (n === cid || n.startsWith(`${cid}.`)) && !n.includes('.tmp-'));
    return name ? join(this.shardDir(cid), name) : null;
  }

  async put(cid: string, bytes: Uint8Array, mimeType?: string | null): Promise<void> {
    if (await this.find(cid)) return;
    const ext = (mimeType ? EXTENSIONS[mimeType] : undefined) ?? sniffExtension(bytes);
    const path = join(this.shardDir(cid), ext ? `${cid}.${ext}` : cid);
    await mkdir(this.shardDir(cid), { recursive: true });
    const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }

  async has(cid: string): Promise<boolean> {
    return (await this.find(cid)) !== null;
  }

  async get(cid: string): Promise<Uint8Array> {
    const path = await this.find(cid);
    if (!path) throw new Error(`Blob not found: ${cid}`);
    return readFile(path);
  }

  async list(): Promise<Array<{ cid: string; sizeBytes: number }>> {
    // Recursive parallel walk of the `<xy>/<zw>/<cid>[.ext]` shard tree; the
    // tail leaves are blob files, everything above is a shard directory.
    const walk = async (dir: string): Promise<Array<{ cid: string; sizeBytes: number }>> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return []; // missing/non-directory — nothing here
      }
      const nested = await Promise.all(
        entries.map(async e => {
          const full = join(dir, e.name);
          if (e.isDirectory()) return walk(full);
          if (e.name.includes('.tmp-')) return []; // interrupted write
          const cid = e.name.split('.')[0]; // CIDs carry no '.'; ext is a suffix
          const { size } = await stat(full);
          return [{ cid, sizeBytes: size }];
        })
      );
      return nested.flat();
    };
    return walk(this.dir);
  }

  async delete(cid: string): Promise<void> {
    const path = await this.find(cid);
    if (path) await rm(path, { force: true });
  }
}
