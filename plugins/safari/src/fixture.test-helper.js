import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Property list dates are seconds since 2001-01-01; 757382400 is 2025-01-01T00:00:00Z.
export const JAN_1 = 757_382_400;
const HOUR = 3600;
const DAY = 24 * HOUR;
const date = seconds => new Date((seconds + 978_307_200) * 1000);

/**
 * Write a Bookmarks.plist: a favorite Safari dated, a favorite in a folder of
 * Favorites that only iCloud dates, a Reading List item, a bookmark that came
 * over from iCloud's older sync, two that iCloud uploaded together, and one
 * that never synced.
 */
export function writeBookmarksFixture(dir) {
  const path = join(dir, 'Bookmarks.plist');
  writeFileSync(
    path,
    binaryPlist(
      folder(null, '8B2F6DF6-0000-4000-8000-000000000000', '', [
        {
          WebBookmarkType: 'WebBookmarkTypeProxy',
          WebBookmarkUUID: '5F0263C5-0000-4000-8000-000000000000',
          Title: 'History',
        },
        folder('Favorites Bar', '78B8E513-0000-4000-8000-000000000000', 'BookmarksBar', [
          leaf('F-1', 'https://example.com/favorite', 'A favorite', {
            created: JAN_1 + 3 * HOUR + 5,
            dateAdded: date(JAN_1 + 3 * HOUR),
          }),
          folder('D-1', 'ECD8FC65-0000-4000-8000-000000000000', 'Design', [
            leaf('B-2', 'https://example.com/design', 'Design', { created: JAN_1 + HOUR }),
          ]),
        ]),
        folder('Bookmarks Menu', 'B8759D89-0000-4000-8000-000000000000', 'BookmarksMenu', []),
        folder('Reading List', 'AEB86B96-0000-4000-8000-000000000000', 'com.apple.ReadingList', [
          leaf('R-1', 'https://example.com/article', 'An article', {
            created: JAN_1 + 2 * HOUR + 0.25,
            ReadingList: { DateAdded: date(JAN_1 + 2 * HOUR) },
          }),
        ]),
        leaf('DAV-abc', 'https://example.com/old', 'Old', { created: JAN_1 - 200 * DAY }),
        leaf('B-3', 'https://example.com/three', 'Three', { created: JAN_1 - 100 * DAY + 0.1 }),
        leaf('B-4', 'https://example.com/four', null, { created: JAN_1 - 100 * DAY + 0.2 }),
        leaf(null, 'https://example.com/local', 'Local', {}),
      ])
    )
  );
  return path;
}

function folder(serverId, uuid, title, children) {
  return {
    WebBookmarkType: 'WebBookmarkTypeList',
    WebBookmarkUUID: uuid,
    Title: title,
    ...(serverId && { Sync: { ServerID: serverId } }),
    Children: children,
  };
}

/** A bookmark; with a server ID, it's synced, made in iCloud at `created`. */
function leaf(serverId, url, title, { created, ...rest }) {
  return {
    WebBookmarkType: 'WebBookmarkTypeLeaf',
    WebBookmarkUUID: `${serverId ?? 'LOCAL'}-UUID`,
    URLString: url,
    URIDictionary: title ? { title } : {},
    ...(serverId && { Sync: { ServerID: serverId, Data: syncData(serverId, created) } }),
    ...rest,
  };
}

/** `Sync.Data`: the CloudKit record Safari last synced, with when iCloud made it. */
function syncData(name, created) {
  const fields = keyedArchive({
    RecordID: { $class: 'CKRecordID', RecordName: name },
    RecordCtime: { $class: 'NSDate', 'NS.time': created },
  });
  return keyedArchive({
    root: {
      $class: 'WBBookmarkSyncData',
      EncodedCKRecordSystemFields: { $class: 'NSMutableData', 'NS.data': fields },
    },
  });
}

/** A reference to an entry in a keyed archive's `$objects`. */
class Uid {
  constructor(index) {
    this.index = index;
  }
}

/**
 * An NSKeyedArchiver archive with `top` as its top-level keys. A plain
 * object with a `$class` is an instance of that class; strings and objects
 * are entries in `$objects`, referred to by index, and numbers and data are
 * kept in place.
 */
function keyedArchive(top) {
  const objects = ['$null'];
  const classes = new Map();
  const push = object => new Uid(objects.push(object) - 1);
  const classOf = name => {
    if (!classes.has(name))
      classes.set(name, push({ $classname: name, $classes: [name, 'NSObject'] }));
    return classes.get(name);
  };
  const add = value => {
    if (value === null || value === undefined) return new Uid(0);
    if (typeof value === 'number' || value instanceof Uint8Array) return value;
    if (typeof value === 'string') return push(value);
    const { $class, ...rest } = value;
    const fields = Object.fromEntries(Object.entries(rest).map(([key, item]) => [key, add(item)]));
    return push({ ...fields, $class: classOf($class) });
  };
  const $top = Object.fromEntries(Object.entries(top).map(([key, value]) => [key, add(value)]));
  return binaryPlist({
    $version: 100_000,
    $archiver: 'NSKeyedArchiver',
    $top,
    $objects: objects,
  });
}

/** Write a `bplist00` file: 2-byte object references and 4-byte offsets. */
function binaryPlist(top) {
  const encoded = [];
  const add = value => {
    const index = encoded.push(null) - 1;
    encoded[index] = encode(value);
    return index;
  };
  // The type in the high four bits, then the length in the low four, or 15
  // and the length as a 4-byte integer object.
  const marker = (type, length) => {
    if (length < 15) return Buffer.from([type * 16 + length]);
    const size = Buffer.alloc(5);
    size[0] = 0x12;
    size.writeUInt32BE(length, 1);
    return Buffer.concat([Buffer.from([type * 16 + 0xf]), size]);
  };
  const refs = indexes => {
    const bytes = Buffer.alloc(indexes.length * 2);
    for (const [i, index] of indexes.entries()) bytes.writeUInt16BE(index, i * 2);
    return bytes;
  };
  const encode = value => {
    if (value instanceof Uid) {
      const bytes = Buffer.alloc(3);
      bytes[0] = 0x81;
      bytes.writeUInt16BE(value.index, 1);
      return bytes;
    }
    if (value instanceof Date) {
      const bytes = Buffer.alloc(9);
      bytes[0] = 0x33;
      bytes.writeDoubleBE(value.getTime() / 1000 - 978_307_200, 1);
      return bytes;
    }
    if (typeof value === 'number') {
      const bytes = Buffer.alloc(9);
      if (Number.isInteger(value)) {
        bytes[0] = 0x13;
        bytes.writeBigInt64BE(BigInt(value), 1);
      } else {
        bytes[0] = 0x23;
        bytes.writeDoubleBE(value, 1);
      }
      return bytes;
    }
    if (typeof value === 'string') {
      // ASCII is a byte a character; anything else is UTF-16.
      if (Buffer.byteLength(value) === value.length) {
        return Buffer.concat([marker(0x5, value.length), Buffer.from(value, 'latin1')]);
      }
      return Buffer.concat([marker(0x6, value.length), Buffer.from(value, 'utf16le').swap16()]);
    }
    if (value instanceof Uint8Array) return Buffer.concat([marker(0x4, value.length), value]);
    if (Array.isArray(value)) {
      const items = value.map(item => add(item));
      return Buffer.concat([marker(0xa, items.length), refs(items)]);
    }
    const keys = Object.keys(value).map(key => add(key));
    const values = Object.values(value).map(item => add(item));
    return Buffer.concat([marker(0xd, keys.length), refs([...keys, ...values])]);
  };

  add(top);
  const header = Buffer.from('bplist00', 'latin1');
  const offsets = Buffer.alloc(encoded.length * 4);
  let at = header.length;
  for (const [i, bytes] of encoded.entries()) {
    offsets.writeUInt32BE(at, i * 4);
    at += bytes.length;
  }
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = 2;
  trailer.writeBigUInt64BE(BigInt(encoded.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(at), 24);
  return Buffer.concat([header, ...encoded, offsets, trailer]);
}
