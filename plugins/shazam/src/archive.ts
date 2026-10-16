import { parseBinaryPlist, Uid, type PlistValue } from '@chronicle.app/apple';
import { APPLE_EPOCH_OFFSET_SECONDS } from '@chronicle.app/etl-sqlite';

/**
 * Core Data keeps a transformable attribute, such as a track's genres, as an
 * NSKeyedArchiver archive in a binary property list (`bplist00`). This reads
 * the archives shazamd writes: arrays, dictionaries, strings, numbers, dates,
 * and data. Other classes come back as `null`.
 */

// Nested containers deeper than this are a malformed (or cyclic) file.
const MAX_DEPTH = 64;

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
