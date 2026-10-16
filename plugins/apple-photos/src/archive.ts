import { parseBinaryPlist, Uid, type PlistValue } from '@chronicle.app/apple';
import { APPLE_EPOCH_OFFSET_SECONDS } from '@chronicle.app/etl-sqlite';

/**
 * Core Data keeps a transformable attribute, such as where a photo was
 * taken, as an NSKeyedArchiver archive in a binary property list. This reads
 * one into plain values: arrays, dictionaries, strings, numbers, dates, and
 * data, and any other archived object as its fields by key.
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
    if ('NS.bytes' in value) return resolve(value['NS.bytes'], depth + 1);
    if ('NS.data' in value) return resolve(value['NS.data'], depth + 1);
    if (typeof value['NS.time'] === 'number') {
      return new Date((value['NS.time'] + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
    }
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, field]) => [key, resolve(field, depth + 1)])
    );
  };

  return resolve(archive.$top?.root ?? null, 0);
}

interface PlaceInfo {
  addressString?: unknown;
  postalAddress?: { [field: string]: unknown } | null;
}

// A postal address's fields, in the order an address is written.
const POSTAL_FIELDS = ['_street', '_subLocality', '_city', '_state', '_postalCode', '_country'];

/**
 * The address Photos looked up for where a photo was taken: its
 * reverse-geocoded place (`PLRevGeoLocationInfo`), as the one line Photos
 * shows, or else its postal address's parts. Null when it has neither.
 */
export function placeAddress(bytes: Uint8Array): string | null {
  const place = unarchive(bytes) as PlaceInfo | null;
  if (typeof place?.addressString === 'string') {
    const line = place.addressString
      .split(/\s*\n\s*/)
      .filter(Boolean)
      .join(', ')
      .trim();
    if (line) return line;
  }
  const postal = place?.postalAddress;
  if (!postal || typeof postal !== 'object') return null;
  const parts = POSTAL_FIELDS.map(field => postal[field]).filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  return parts.length > 0 ? parts.join(', ') : null;
}
