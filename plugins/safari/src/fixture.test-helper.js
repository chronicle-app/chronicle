import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const JAN_1 = new Date('2025-01-01T00:00:00Z').getTime();
const HOUR = 3_600_000;
const date = ms => new Date(JAN_1 + ms);

/**
 * Write a Bookmarks.plist: a favorite, a favorite in a folder of Favorites, a
 * Reading List item, an older favorite Safari didn't date, a bookmark with no
 * title, and one that never synced.
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
          leaf('F-1', 'https://example.com/favorite', 'A favorite', { dateAdded: date(3 * HOUR) }),
          folder('D-1', 'ECD8FC65-0000-4000-8000-000000000000', 'Design', [
            leaf('B-2', 'https://example.com/design', 'Design', { dateAdded: date(HOUR) }),
          ]),
          leaf('F-2', 'https://example.com/older', 'An older favorite', {}),
        ]),
        folder('Bookmarks Menu', 'B8759D89-0000-4000-8000-000000000000', 'BookmarksMenu', []),
        folder('Reading List', 'AEB86B96-0000-4000-8000-000000000000', 'com.apple.ReadingList', [
          leaf('R-1', 'https://example.com/article', 'An article', {
            ReadingList: { DateAdded: date(2 * HOUR) },
          }),
        ]),
        leaf('B-3', 'https://example.com/three', null, {}),
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

/** A bookmark; with a server ID, it syncs with iCloud. */
function leaf(serverId, url, title, rest) {
  return {
    WebBookmarkType: 'WebBookmarkTypeLeaf',
    WebBookmarkUUID: `${serverId ?? 'LOCAL'}-UUID`,
    URLString: url,
    URIDictionary: title ? { title } : {},
    ...(serverId && { Sync: { ServerID: serverId } }),
    ...rest,
  };
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
    if (value instanceof Date) {
      const bytes = Buffer.alloc(9);
      bytes[0] = 0x33;
      bytes.writeDoubleBE(value.getTime() / 1000 - 978_307_200, 1);
      return bytes;
    }
    if (typeof value === 'string') {
      // ASCII is a byte a character; anything else is UTF-16.
      if (Buffer.byteLength(value) === value.length) {
        return Buffer.concat([marker(0x5, value.length), Buffer.from(value, 'latin1')]);
      }
      return Buffer.concat([marker(0x6, value.length), Buffer.from(value, 'utf16le').swap16()]);
    }
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
