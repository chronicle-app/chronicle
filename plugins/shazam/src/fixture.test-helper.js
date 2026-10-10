import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
const JAN_1 = 757_382_400;
// 2020-05-01T00:00:00Z: Apple Music's release dates are midnights in UTC.
const MAY_1_2020 = 609_984_000;

export const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

/**
 * A synthetic ShazamLibrary.sqlite, with shazamd's ZSHTRACKMO table:
 *
 * - RECOGNITION-1: matched on Apple Music, with a location. A second, older
 *   copy of it (as a sync can leave) has a stale title.
 * - RECOGNITION-2: from Music Recognition, with no Apple Music match, no
 *   location fix (0, 0), and Shazam's no-cover artwork.
 * - SYNC-4: no recognition ID, so it is known by its sync ID; the same song
 *   as RECOGNITION-1, Shazamed again, with the other no-fix location (-180, -180).
 */
export function writeShazamFixture(dir) {
  const input = join(dir, 'ShazamLibrary.sqlite');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE ZSHTRACKMO ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER,
      ZEXPLICIT INTEGER, ZSHAZAMCOUNT INTEGER, ZGROUP INTEGER, ZMETADATA INTEGER, ZDATE TIMESTAMP,
      ZLATITUDE FLOAT, ZLONGITUDE FLOAT, ZMODIFIEDDATE TIMESTAMP, ZRELEASEDATE TIMESTAMP,
      ZALBUMNAME VARCHAR, ZAPPLEMUSICID VARCHAR, ZISRC VARCHAR, ZPROVIDERID VARCHAR,
      ZPROVIDERNAME VARCHAR, ZRECOGNITIONID VARCHAR, ZSHAZAMKEY VARCHAR, ZSUBTITLE VARCHAR,
      ZSYNCID VARCHAR, ZTITLE VARCHAR, ZAPPLEMUSICURL VARCHAR, ZARTWORKURL VARCHAR,
      ZSHAZAMURL VARCHAR, ZVIDEOURL VARCHAR, ZGENRES BLOB, ZLABELS BLOB, ZRAWSONGRESPONSE BLOB );
  `);

  const matched = {
    ZDATE: JAN_1 + 60.25,
    ZLATITUDE: 43.65,
    ZLONGITUDE: -79.38,
    ZRELEASEDATE: MAY_1_2020,
    ZALBUMNAME: 'Example Album',
    ZAPPLEMUSICID: '2001',
    ZISRC: 'USX000000001',
    ZPROVIDERID: 'com.shazam.Shazam',
    ZPROVIDERNAME: 'Shazam',
    ZRECOGNITIONID: 'RECOGNITION-1',
    ZSHAZAMKEY: '1001',
    ZSUBTITLE: 'Example Artist Feat. Guest',
    ZSYNCID: 'SYNC-1',
    ZTITLE: 'Example Song (Original Mix)',
    ZEXPLICIT: 0,
    ZAPPLEMUSICURL:
      'https://music.apple.com/us/album/example-album/3001?i=2001&itscg=30201&itsct=bglsk',
    ZARTWORKURL: 'https://is1-ssl.mzstatic.com/image/thumb/example/800x800bb.heic',
    ZSHAZAMURL: 'https://www.shazam.com/track/1001/example-song?co=US',
    ZGENRES: keyedArchive(['Música Mexicana', 'Music']),
    ZLABELS: keyedArchive(['platform_macos']),
    ZRAWSONGRESPONSE: keyedArchive({
      SHMediaLibraryDataStoreRawResponseSongsData: new TextEncoder().encode(
        JSON.stringify({
          id: '2001',
          type: 'songs',
          attributes: {
            name: 'Example Song',
            artistName: 'Example Artist',
            albumName: 'Example Album',
            durationInMillis: 201_500,
            isrc: 'USX000000001',
            url: 'https://music.apple.com/us/album/example-album/3001?i=2001',
          },
        })
      ),
    }),
  };

  insert(db, { Z_PK: 1, ...matched, ZMODIFIEDDATE: JAN_1 + 1000 });
  insert(db, { Z_PK: 2, ...matched, ZMODIFIEDDATE: JAN_1 + 500, ZTITLE: 'Stale Copy' });
  insert(db, {
    Z_PK: 3,
    ZDATE: JAN_1 + 120,
    ZLATITUDE: 0,
    ZLONGITUDE: 0,
    ZPROVIDERID: 'com.apple.musicrecognition',
    ZPROVIDERNAME: 'Music Recognition',
    ZRECOGNITIONID: 'RECOGNITION-2',
    ZSHAZAMKEY: '1002',
    ZSUBTITLE: 'Another Artist',
    ZSYNCID: 'SYNC-2',
    ZTITLE: 'Unmatched Song',
    ZARTWORKURL: 'https://images.shazam.com/static/coverart/unavailable_s400.png',
    ZSHAZAMURL: 'https://www.shazam.com/track/1002/unmatched-song',
    ZLABELS: keyedArchive(['platform_macos']),
  });
  insert(db, {
    Z_PK: 4,
    ...matched,
    ZDATE: JAN_1 + 180,
    ZLATITUDE: -180,
    ZLONGITUDE: -180,
    ZRECOGNITIONID: null,
    ZSYNCID: 'SYNC-4',
    ZMODIFIEDDATE: JAN_1 + 1000,
  });
  db.close();
  return input;
}

function insert(db, row) {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ZSHTRACKMO (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).run(...Object.values(row));
}

/** A reference to an entry in a keyed archive's `$objects`. */
class Uid {
  constructor(index) {
    this.index = index;
  }
}

/**
 * Encode a value the way Core Data stores a transformable attribute: an
 * NSKeyedArchiver archive in a binary property list. Takes arrays, plain
 * objects (as dictionaries), strings, and Uint8Arrays (as data).
 */
function keyedArchive(value) {
  const objects = ['$null'];
  const classes = new Map();
  const push = object => new Uid(objects.push(object) - 1);
  const classOf = name => {
    if (!classes.has(name))
      classes.set(name, push({ $classname: name, $classes: [name, 'NSObject'] }));
    return classes.get(name);
  };
  const add = item => {
    if (item === null) return new Uid(0);
    if (Array.isArray(item))
      return push({ 'NS.objects': item.map(each => add(each)), $class: classOf('NSArray') });
    if (typeof item === 'object' && !(item instanceof Uint8Array)) {
      return push({
        'NS.keys': Object.keys(item).map(key => add(key)),
        'NS.objects': Object.values(item).map(each => add(each)),
        $class: classOf('NSDictionary'),
      });
    }
    return push(item);
  };
  const root = add(value);
  return binaryPlist({
    $version: 100_000,
    $archiver: 'NSKeyedArchiver',
    $top: { root },
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
    if (typeof value === 'number') {
      const bytes = Buffer.alloc(9);
      bytes[0] = 0x13;
      bytes.writeBigInt64BE(BigInt(value), 1);
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
