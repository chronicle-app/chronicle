/**
 * A binary property list (`bplist00`), the format Apple software uses for
 * preferences, for archives such as an NSKeyedArchiver archive, and for
 * Core Data's transformable attributes. Arrays, sets, dictionaries, strings,
 * numbers, dates, data, and archive references (`Uid`).
 */

// Property list dates count seconds from 2001-01-01.
const APPLE_EPOCH_OFFSET_SECONDS = 978_307_200;

/** A reference to an entry in an archive's `$objects`. */
export class Uid {
  readonly index: number;
  constructor(index: number) {
    this.index = index;
  }
}

export type PlistValue =
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
