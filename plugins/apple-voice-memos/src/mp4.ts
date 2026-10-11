import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

/** What Voice Memos writes into a recording's file besides the audio. */
export interface RecordingMetadata {
  /** The `©too` tag: the app and the kind of device that recorded it. */
  encoder: string | null;
  /** The transcript's JSON, as Voice Memos stores it. */
  transcript: string | null;
}

/** A box's type, where it begins, and where its contents lie, after its header. */
interface Box {
  type: string;
  offset: number;
  start: number;
  end: number;
}

// The metadata key a `.qta` file stores its transcript under.
const TRANSCRIPT_KEY = 'com.apple.VoiceMemos.tsrp';

// A movie header far larger than any recording's is a damaged file.
const MAX_MOOV = 64 * 1024 * 1024;

/**
 * Read the encoder tag and the transcript from a recording. Both formats are
 * QuickTime movies: an `.m4a` keeps its transcript in a track's `udta/tsrp`
 * box, and a `.qta` in a track's metadata under `com.apple.VoiceMemos.tsrp`.
 * Only the movie header (`moov`) is read, not the audio. Null when the file is
 * missing, empty, or has no movie header.
 */
export function readRecordingMetadata(path: string): RecordingMetadata | null {
  const moov = readMoov(path);
  if (!moov) return null;
  return { encoder: encoderOf(moov), transcript: transcriptOf(moov) };
}

/** The `moov` box's contents, found by reading only the top-level box headers. */
function readMoov(path: string): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const length = fstatSync(fd).size;
    const header = Buffer.alloc(16);
    let at = 0;
    while (at + 8 <= length) {
      readSync(fd, header, 0, 16, at);
      const box = boxAt(header, 0, length - at);
      if (!box) throw new Error(`Damaged box at byte ${at}`);
      if (box.type === 'moov') {
        const size = box.end - box.start;
        if (size > MAX_MOOV) throw new Error(`Movie header too large (${size} bytes)`);
        const moov = Buffer.alloc(size);
        readSync(fd, moov, 0, size, at + box.start);
        return moov;
      }
      at += box.end;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * The box at `at`, with offsets relative to `buf`. A 32-bit size of 1 means a
 * 64-bit size follows the type, and 0 means the box runs to `end`. Null when
 * the header doesn't fit.
 */
function boxAt(buf: Buffer, at: number, end: number): Box | null {
  if (at + 8 > end) return null;
  let size = buf.readUInt32BE(at);
  const type = buf.toString('latin1', at + 4, at + 8);
  let header = 8;
  if (size === 1) {
    if (at + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(at + 8));
    header = 16;
  } else if (size === 0) {
    size = end - at;
  }
  if (size < header || at + size > end) return null;
  return { type, offset: at, start: at + header, end: at + size };
}

/** The boxes inside `start`..`end`, optionally only those of one type. */
function childrenOf(buf: Buffer, start: number, end: number, type?: string): Box[] {
  const boxes: Box[] = [];
  for (let at = start; at < end;) {
    const box = boxAt(buf, at, end);
    if (!box) break;
    if (!type || box.type === type) boxes.push(box);
    at = box.end;
  }
  return boxes;
}

/**
 * Where a `meta` box's children start. An ISO `meta` box opens with a version
 * and flags word, which is zero; a QuickTime one starts with its first child,
 * whose size isn't.
 */
function metaChildrenStart(buf: Buffer, meta: Box): number {
  return meta.end - meta.start >= 4 && buf.readUInt32BE(meta.start) === 0
    ? meta.start + 4
    : meta.start;
}

/** A metadata item's value: its `data` box, after the type and locale words. */
function dataOf(buf: Buffer, item: Box): Buffer | null {
  const data = childrenOf(buf, item.start, item.end, 'data')[0];
  if (!data || data.end - data.start < 8) return null;
  return buf.subarray(data.start + 8, data.end);
}

/** The `©too` tag in the movie's `udta/meta/ilst`. */
function encoderOf(moov: Buffer): string | null {
  for (const udta of childrenOf(moov, 0, moov.length, 'udta')) {
    for (const meta of childrenOf(moov, udta.start, udta.end, 'meta')) {
      for (const ilst of childrenOf(moov, metaChildrenStart(moov, meta), meta.end, 'ilst')) {
        for (const item of childrenOf(moov, ilst.start, ilst.end, '©too')) {
          const value = dataOf(moov, item);
          if (value) return value.toString('utf8');
        }
      }
    }
  }
  return null;
}

/** The transcript JSON from the first track that has one. */
function transcriptOf(moov: Buffer): string | null {
  for (const trak of childrenOf(moov, 0, moov.length, 'trak')) {
    for (const udta of childrenOf(moov, trak.start, trak.end, 'udta')) {
      const tsrp = childrenOf(moov, udta.start, udta.end, 'tsrp')[0];
      if (tsrp) return moov.toString('utf8', tsrp.start, tsrp.end);
    }
    for (const meta of childrenOf(moov, trak.start, trak.end, 'meta')) {
      const value = mdtaValue(moov, meta, TRANSCRIPT_KEY);
      if (value) return value.toString('utf8');
    }
  }
  return null;
}

/**
 * The value of a QuickTime metadata key. The `keys` box lists the keys, and
 * each `ilst` item's type is the 1-based index of its key.
 */
function mdtaValue(buf: Buffer, meta: Box, key: string): Buffer | null {
  const start = metaChildrenStart(buf, meta);
  const keys = childrenOf(buf, start, meta.end, 'keys')[0];
  const ilst = childrenOf(buf, start, meta.end, 'ilst')[0];
  if (!keys || !ilst || keys.end - keys.start < 8) return null;

  // After the version and flags word, a count, then each key's size,
  // namespace, and name.
  const count = buf.readUInt32BE(keys.start + 4);
  let index = 0;
  for (let i = 1, at = keys.start + 8; i <= count && at + 8 <= keys.end; i++) {
    const size = buf.readUInt32BE(at);
    if (size < 8 || at + size > keys.end) break;
    const namespace = buf.toString('latin1', at + 4, at + 8);
    if (namespace === 'mdta' && buf.toString('utf8', at + 8, at + size) === key) {
      index = i;
      break;
    }
    at += size;
  }
  if (!index) return null;

  for (const item of childrenOf(buf, ilst.start, ilst.end)) {
    if (buf.readUInt32BE(item.offset + 4) === index) return dataOf(buf, item);
  }
  return null;
}
