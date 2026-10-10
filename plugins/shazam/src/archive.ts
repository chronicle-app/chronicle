import { APPLE_EPOCH_OFFSET_SECONDS } from '@chronicle.app/etl-sqlite';

/**
 * Core Data keeps a transformable attribute, such as a track's genres, as an
 * NSKeyedArchiver archive in a binary property list (`bplist00`). This reads
 * the archives shazamd writes: arrays, dictionaries, strings, numbers, dates,
 * and data. Other classes come back as `null`.
 */

/** A reference to an entry in an archive's `$objects`. */
class Uid {
  readonly index: number;
  constructor(index: number) {
    this.index = index;
  }
}

type PlistValue =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | Uid
  | PlistValue[]
  | { [key: string]: PlistValue };

// Nested containers deeper than this are a malformed (or cyclic) file.
const MAX_DEPTH = 64;

/** Parse a binary property list. */
export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') {
    throw new Error('Not a binary property list');
  }
  const trailer = buf.length - 32;
  const offsetSize = buf[trailer + 6];
  const refSize = buf[trailer + 7];
  const count = Number(buf.readBigUInt64BE(trailer + 8));
  const top = Number(buf.readBigUInt64BE(trailer + 16));
  const offsetTable = Number(buf.readBigUInt64BE(trailer + 24));

  const uint = (at: number, size: number): number => {
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + buf[at + i];
    return n;
  };

  const read = (index: number, depth: number): PlistValue => {
    if (index >= count || depth > MAX_DEPTH) throw new Error('Malformed binary property list');
    const at = uint(offsetTable + index * offsetSize, offsetSize);
    // A marker byte holds the object's type in its high four bits and its
    // size or count in its low four.
    const type = Math.floor(buf[at] / 16);
    const info = buf[at] % 16;
    // A count of 15 or more follows the marker as an integer object.
    let length = info;
    let start = at + 1;
    if (info === 0xf) {
      const size = 2 ** (buf[at + 1] % 16);
      length = uint(at + 2, size);
      start = at + 2 + size;
    }
    const refs = (offset: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        read(uint(start + (offset + i) * refSize, refSize), depth + 1)
      );

    switch (type) {
      case 0x0:
        return info === 0x9 ? true : info === 0x8 ? false : null;
      case 0x1:
        return info === 3 ? Number(buf.readBigInt64BE(at + 1)) : uint(at + 1, 2 ** info);
      case 0x2:
        return info === 2 ? buf.readFloatBE(at + 1) : buf.readDoubleBE(at + 1);
      case 0x3:
        return new Date((buf.readDoubleBE(at + 1) + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
      case 0x4:
        return buf.subarray(start, start + length);
      case 0x5:
        return buf.toString('latin1', start, start + length);
      case 0x6:
        // UTF-16 big-endian; Node decodes only little-endian.
        return Buffer.from(buf.subarray(start, start + length * 2))
          .swap16()
          .toString('utf16le');
      case 0x8:
        return new Uid(uint(at + 1, info + 1));
      case 0xa:
      case 0xc:
        return refs(0, length);
      case 0xd: {
        const keys = refs(0, length);
        const values = refs(length, length);
        return Object.fromEntries(keys.map((key, i) => [String(key), values[i]]));
      }
      default:
        throw new Error(`Unsupported binary property list type 0x${type.toString(16)}`);
    }
  };

  return read(top, 0);
}

/** Decode an NSKeyedArchiver archive to plain values. */
export function unarchive(bytes: Uint8Array): unknown {
  const archive = parseBinaryPlist(bytes) as { [key: string]: any };
  const objects = archive?.$objects;
  if (archive?.$archiver !== 'NSKeyedArchiver' || !Array.isArray(objects)) {
    throw new Error('Not a keyed archive');
  }

  const resolve = (value: PlistValue, depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new Error('Malformed keyed archive');
    if (value instanceof Uid) {
      // Entry 0 is `$null`, the archive's nil.
      if (value.index === 0) return null;
      return resolve(objects[value.index], depth + 1);
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) return value;
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value)) return value.map(item => resolve(item, depth + 1));
    if (Array.isArray(value['NS.keys']) && Array.isArray(value['NS.objects'])) {
      const values = value['NS.objects'];
      return Object.fromEntries(
        value['NS.keys'].map((key, i) => [
          String(resolve(key, depth + 1)),
          resolve(values[i], depth + 1),
        ])
      );
    }
    if (Array.isArray(value['NS.objects'])) return resolve(value['NS.objects'], depth + 1);
    if ('NS.string' in value) return resolve(value['NS.string'], depth + 1);
    if ('NS.data' in value) return resolve(value['NS.data'], depth + 1);
    if (typeof value['NS.time'] === 'number') {
      return new Date((value['NS.time'] + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
    }
    return null;
  };

  return resolve(archive.$top?.root ?? null, 0);
}
