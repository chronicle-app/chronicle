import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

// Core Data dates are seconds since 2001-01-01; 757382400 is 2025-01-01T00:00:00Z.
const JAN_1 = 757_382_400;
// Notes stamps text with Unix seconds; this is 2025-01-01T12:00:00Z.
export const NOON = 1_735_732_800;
const apple = unix => unix - 978_307_200;

/** The Notes installs that typed the fixture's text, by replica UUID. */
export const REPLICA = {
  mac: 'AAAAAAAA-0000-4000-8000-000000000001',
  samPhone: 'BBBBBBBB-0000-4000-8000-000000000002',
  stranger: 'CCCCCCCC-0000-4000-8000-000000000003',
};

/** CloudKit user IDs in Notes: yours, as the account records it, and Sam's. */
export const USER = { you: '_you', sam: '_sam' };

/** The Apple Account signed in on the Mac, which is you. */
export const ACCOUNT = {
  accountID: 'pat@example.com',
  displayName: 'Pat Doe',
  email: 'pat@example.com',
  dsid: '8000001',
};

/** Contacts on the Mac: a card for Sam, with a number no share lists. */
const CARDS = [
  {
    id: 'CONTACT-SAM',
    firstName: 'Sam',
    lastName: 'Rivera',
    fullName: 'Sam Rivera',
    emails: ['sam@example.com'],
    phoneNumbers: ['+1 613-555-0142'],
  },
];

/** Find a card by an email or a number, as Contacts does, without reading the host's. */
export const lookupContact = handle =>
  CARDS.find(
    card =>
      card.emails.includes(handle) ||
      card.phoneNumbers.some(phone => phone.replaceAll(/\D/g, '') === handle.replaceAll(/\D/g, ''))
  ) ?? null;

/**
 * A synthetic NoteStore.sqlite, with an image and a drawing under Accounts/ beside it, in
 * the columns current macOS uses. Pat (you) and Sam share notes both ways,
 * and each share lists Sam at a different email:
 *
 * - NOTE-GARDEN is yours and shared with Sam. You wrote a title, a line with
 *   a link and a bold word you typed across two seconds, and a ticked
 *   checklist item; two minutes later Sam added
 *   to the end of that item and added another from a phone; three hours
 *   later you added an image, a drawing, and a hashtag. Some of your text was deleted,
 *   which leaves only a tombstone. Notes saved it a moment after the last
 *   text, to a fraction of a second, as it does.
 * - NOTE-SOUP is in Sam's Kitchen folder, made by Sam. Sam wrote most of it,
 *   leaving spaces at the end of a line, you added a line, and a replica the note doesn't map to anyone added the
 *   last, which synced in without moving when Notes last saved the note. It
 *   holds a table, which isn't a file.
 * - NOTE-OLD predates write times and was never synced, so it was made here.
 * - NOTE-LOCKED is password protected, so its text can't be read. It was made
 *   before the garden note and last edited after it.
 * - NOTE-GONE is marked for deletion, so it's left out.
 */
export function writeNotesFixture(dir) {
  const input = join(dir, 'NoteStore.sqlite');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER PRIMARY KEY, Z_NAME VARCHAR);
    CREATE TABLE ZICCLOUDSYNCINGOBJECT (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZIDENTIFIER VARCHAR,
      ZMARKEDFORDELETION INTEGER, ZTITLE1 VARCHAR, ZCREATIONDATE3 TIMESTAMP,
      ZMODIFICATIONDATE1 TIMESTAMP, ZISPASSWORDPROTECTED INTEGER, ZISPINNED INTEGER,
      ZFOLDER INTEGER, ZACCOUNT7 INTEGER, ZREPLICAIDTOUSERIDDICTDATA BLOB,
      ZSERVERRECORDDATA BLOB, ZSERVERSHAREDATA BLOB, ZTITLE2 VARCHAR, ZFOLDERTYPE INTEGER,
      ZUSERRECORDNAME VARCHAR, ZNOTE INTEGER, ZTYPEUTI VARCHAR, ZTITLE VARCHAR,
      ZCREATIONDATE TIMESTAMP, ZMEDIA INTEGER, ZACCOUNT1 INTEGER, ZFILENAME VARCHAR,
      ZALTTEXT VARCHAR, ZTYPEUTI1 VARCHAR, ZNOTE1 INTEGER, ZZONEOWNERNAME VARCHAR,
      ZGENERATION1 VARCHAR, ZFALLBACKIMAGEGENERATION VARCHAR);
    CREATE TABLE ZICNOTEDATA (Z_PK INTEGER PRIMARY KEY, ZNOTE INTEGER, ZDATA BLOB);
    INSERT INTO Z_PRIMARYKEY VALUES (5, 'ICAttachment'), (9, 'ICInlineAttachment'),
      (11, 'ICMedia'), (12, 'ICNote'), (14, 'ICAccount'), (15, 'ICFolder');
  `);

  const pat = { given: 'Pat', family: 'Doe', email: 'pat@example.com', phone: '16135550100' };
  const sam = { given: 'Sam', family: 'Rivera' };

  insert(db, { Z_PK: 1, Z_ENT: 14, ZIDENTIFIER: 'ACCOUNT-1', ZUSERRECORDNAME: USER.you });
  insert(db, { Z_PK: 2, Z_ENT: 15, ZIDENTIFIER: 'FOLDER-NOTES', ZTITLE2: 'Notes', ZFOLDERTYPE: 0 });
  // A folder someone shared with you is in their zone, which names them.
  insert(db, {
    Z_PK: 3,
    Z_ENT: 15,
    ZIDENTIFIER: 'FOLDER-KITCHEN',
    ZTITLE2: 'Kitchen',
    ZZONEOWNERNAME: USER.sam,
  });

  const note = (pk, row, body) => {
    insert(db, { Z_PK: pk, Z_ENT: 12, ZACCOUNT7: 1, ZISPASSWORDPROTECTED: 0, ...row });
    if (body) db.prepare('INSERT INTO ZICNOTEDATA (ZNOTE, ZDATA) VALUES (?, ?)').run(pk, body);
  };

  note(
    10,
    {
      ZIDENTIFIER: 'NOTE-GARDEN',
      ZTITLE1: 'Garden plan',
      ZCREATIONDATE3: apple(NOON - 60),
      ZMODIFICATIONDATE1: apple(NOON + 3 * 3600 + 30.25),
      ZFOLDER: 2,
      ZISPINNED: 1,
      ZREPLICAIDTOUSERIDDICTDATA: replicaUsers([
        [REPLICA.mac, USER.you],
        [REPLICA.samPhone, USER.sam],
      ]),
      ZSERVERRECORDDATA: cloudRecord('__defaultOwner__'),
      // A share you own lists you as the current user.
      ZSERVERSHAREDATA: cloudShare([
        { id: '__defaultOwner__', ...pat },
        { id: USER.sam, ...sam, email: 'sam@example.com' },
        { email: 'invited@example.com' },
      ]),
    },
    noteData(
      [REPLICA.mac, REPLICA.samPhone],
      [
        { text: 'Garden plan\n', replica: 1, at: NOON, style: 0 },
        { text: 'Order ', replica: 1, at: NOON + 60 },
        { text: 'se', replica: 1, at: NOON + 60, weight: 1 },
        { text: 'eds', replica: 1, at: NOON + 61, weight: 1 },
        { text: ' from ', replica: 1, at: NOON + 60 },
        { text: 'the catalog', replica: 1, at: NOON + 60, link: 'https://seeds.example.com' },
        { deleted: 9 },
        { text: '\n', replica: 1, at: NOON + 60 },
        { text: 'Tomatoes', replica: 1, at: NOON + 120, style: 103, checked: true },
        { text: ', cherry', replica: 2, at: NOON + 240, style: 103, checked: true },
        { text: '\n', replica: 1, at: NOON + 120, style: 103, checked: true },
        { text: 'Basil\n', replica: 2, at: NOON + 240, style: 103, checked: false },
        { text: '￼', replica: 1, at: NOON + 3 * 3600, attachment: 'IMAGE-1' },
        { text: '\n', replica: 1, at: NOON + 3 * 3600 + 10 },
        { text: '￼', replica: 1, at: NOON + 3 * 3600 + 10, attachment: 'SKETCH-1' },
        { text: '\nSee ', replica: 1, at: NOON + 3 * 3600 + 30 },
        { text: '￼', replica: 1, at: NOON + 3 * 3600 + 30, attachment: 'TAG-GARDEN' },
      ]
    )
  );

  note(
    11,
    {
      ZIDENTIFIER: 'NOTE-SOUP',
      ZTITLE1: 'Soup',
      ZCREATIONDATE3: apple(NOON + 86_400),
      ZMODIFICATIONDATE1: apple(NOON + 86_400 + 450),
      ZFOLDER: 3,
      ZREPLICAIDTOUSERIDDICTDATA: replicaUsers([
        [REPLICA.samPhone, USER.sam],
        [REPLICA.mac, USER.you],
      ]),
      ZSERVERRECORDDATA: cloudRecord(USER.sam),
      ZSERVERSHAREDATA: cloudShare([
        { id: USER.sam, ...sam, email: 'sam.rivera@work.example.com' },
        { id: USER.you, ...pat },
      ]),
    },
    noteData(
      [REPLICA.samPhone, REPLICA.mac, REPLICA.stranger],
      [
        { text: 'Soup\n', replica: 1, at: NOON + 86_400, style: 0 },
        { text: 'Carrots, leeks  \n', replica: 1, at: NOON + 86_400 + 30 },
        { text: '￼', replica: 1, at: NOON + 86_400 + 40, attachment: 'TABLE-1' },
        { text: '\nMore salt\n', replica: 2, at: NOON + 86_400 + 400 },
        { text: 'Bay leaf', replica: 3, at: NOON + 86_400 + 500 },
      ]
    )
  );

  note(
    12,
    {
      ZIDENTIFIER: 'NOTE-OLD',
      ZTITLE1: 'Old list',
      ZCREATIONDATE3: JAN_1 - 5 * 365 * 86_400,
      ZFOLDER: 2,
    },
    noteData(
      [REPLICA.mac],
      [
        { text: 'Old list\n', replica: 1, style: 0 },
        { text: 'Milk', replica: 1, style: 100 },
      ]
    )
  );

  note(
    13,
    {
      ZIDENTIFIER: 'NOTE-LOCKED',
      ZTITLE1: 'Locked',
      ZCREATIONDATE3: apple(NOON - 3600),
      ZMODIFICATIONDATE1: apple(NOON + 4 * 3600),
      ZISPASSWORDPROTECTED: 1,
      ZFOLDER: 2,
      ZSERVERRECORDDATA: cloudRecord('__defaultOwner__'),
    },
    Buffer.from('encrypted')
  );

  note(
    14,
    {
      ZIDENTIFIER: 'NOTE-GONE',
      ZTITLE1: 'Gone',
      ZCREATIONDATE3: apple(NOON + 2 * 86_400),
      ZMARKEDFORDELETION: 1,
      ZFOLDER: 2,
    },
    noteData([REPLICA.mac], [{ text: 'Gone', replica: 1, at: NOON + 2 * 86_400 }])
  );

  insert(db, {
    Z_PK: 20,
    Z_ENT: 5,
    ZIDENTIFIER: 'IMAGE-1',
    ZNOTE: 10,
    ZTYPEUTI: 'public.jpeg',
    ZCREATIONDATE: apple(NOON + 3 * 3600),
    ZMEDIA: 21,
    ZACCOUNT1: 1,
  });
  insert(db, {
    Z_PK: 21,
    Z_ENT: 11,
    ZIDENTIFIER: 'MEDIA-1',
    ZFILENAME: 'seedlings.jpeg',
    ZGENERATION1: 'GENERATION-2',
  });
  // A drawing has no media, only the image Notes keeps of it.
  insert(db, {
    Z_PK: 23,
    Z_ENT: 5,
    ZIDENTIFIER: 'SKETCH-1',
    ZNOTE: 10,
    ZTYPEUTI: 'com.apple.paper',
    ZCREATIONDATE: apple(NOON + 3 * 3600 + 10),
    ZACCOUNT1: 1,
    ZFALLBACKIMAGEGENERATION: 'GENERATION-1',
  });
  insert(db, {
    Z_PK: 22,
    Z_ENT: 5,
    ZIDENTIFIER: 'TABLE-1',
    ZNOTE: 11,
    ZTYPEUTI: 'com.apple.notes.table',
    ZACCOUNT1: 1,
  });
  insert(db, {
    Z_PK: 30,
    Z_ENT: 9,
    ZIDENTIFIER: 'TAG-GARDEN',
    ZTYPEUTI1: 'com.apple.notes.inlinetextattachment.hashtag',
    ZALTTEXT: '#garden',
    ZNOTE1: 10,
  });
  db.close();

  // The image was edited once, which left its first generation beside the one
  // the media names, and Finder left a file of its own.
  const media = join(dir, 'Accounts', 'ACCOUNT-1', 'Media', 'MEDIA-1');
  for (const generation of ['GENERATION-1', 'GENERATION-2']) {
    mkdirSync(join(media, generation), { recursive: true });
    writeFileSync(join(media, generation, 'seedlings.jpeg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
  writeFileSync(join(media, '.DS_Store'), '');
  const drawing = join(dir, 'Accounts', 'ACCOUNT-1', 'FallbackImages', 'SKETCH-1', 'GENERATION-1');
  mkdirSync(drawing, { recursive: true });
  writeFileSync(join(drawing, 'FallbackImage.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return input;
}

function insert(db, row) {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ZICCLOUDSYNCINGOBJECT (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).run(...Object.values(row));
}

// A protobuf message is its fields in order: a key (field number and wire
// type), then a varint, or a length and that many bytes.
function varint(n) {
  const bytes = [];
  for (; n >= 0x80; n = Math.floor(n / 0x80)) bytes.push((n % 0x80) + 0x80);
  bytes.push(n);
  return Buffer.from(bytes);
}
const int = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
const message = (field, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
};
const string = (field, value) => message(field, Buffer.from(value, 'utf8'));
const uuidBytes = uuid => Buffer.from(uuid.replaceAll('-', ''), 'hex');

/**
 * A note's ZDATA: gzip of a protobuf holding the text CRDT. Each piece is one
 * substring, typed by a replica (its 1-based index), and one attribute run,
 * stamped with when it was written; `{ deleted: n }` is a tombstone for n
 * characters of deleted text.
 */
export function noteData(replicas, pieces) {
  const live = pieces.filter(piece => !piece.deleted);
  const substrings = [
    message(3, message(1, int(1, 0), int(2, 0)), int(2, 0)),
    ...pieces.map((piece, i) =>
      piece.deleted
        ? message(3, message(1, int(1, 1), int(2, 1000 + i)), int(2, piece.deleted), int(4, 1))
        : message(3, message(1, int(1, piece.replica), int(2, i)), int(2, piece.text.length))
    ),
  ];
  const clock = message(
    4,
    ...replicas.map(replica => message(1, message(1, uuidBytes(replica)), message(2, int(1, 1))))
  );
  const runs = live.map(piece =>
    message(
      5,
      int(1, piece.text.length),
      ...(piece.style === undefined
        ? []
        : [
            message(
              2,
              int(1, piece.style),
              ...(piece.checked === undefined
                ? []
                : [message(5, message(1, Buffer.alloc(16)), int(2, piece.checked ? 1 : 0))])
            ),
          ]),
      ...(piece.weight ? [int(5, piece.weight)] : []),
      ...(piece.link ? [string(9, piece.link)] : []),
      ...(piece.attachment ? [message(12, string(1, piece.attachment))] : []),
      ...(piece.at === undefined ? [] : [int(13, piece.at)])
    )
  );
  const note = message(
    3,
    string(2, live.map(piece => piece.text).join('')),
    ...substrings,
    clock,
    ...runs
  );
  return gzipSync(Buffer.concat([int(1, 0), message(2, int(1, 0), int(2, 0), note)]));
}

/**
 * ZREPLICAIDTOUSERIDDICTDATA: a CRDT dictionary from replica UUID to CloudKit
 * user ID. Object 0 is the dictionary; each key and value is an object
 * holding one string.
 */
function replicaUsers(pairs) {
  const strings = [];
  const object = value => strings.push(value);
  const entries = pairs.map(([replica, user]) =>
    message(1, message(1, int(6, object(replica))), message(2, int(6, object(user))))
  );
  return Buffer.concat([
    message(3, message(6, ...entries)),
    ...strings.map(value =>
      message(3, message(13, int(1, 1), message(3, int(1, 0), message(2, string(4, value)))))
    ),
    string(4, 'self'),
    string(5, 'com.apple.CRDT.NSString'),
  ]);
}

/** ZSERVERRECORDDATA: the note's CloudKit record, with who created it. */
function cloudRecord(creator) {
  return keyedArchive({
    RecordType: 'Note',
    CreatorUserRecordID: { $class: 'CKRecordID', RecordName: creator },
  });
}

/** ZSERVERSHAREDATA: a CloudKit share and the people it lists. */
function cloudShare(people) {
  return keyedArchive({
    RecordType: 'cloudkit.share',
    Participants: people.map(({ id, given, family, email, phone }) => ({
      $class: 'CKShareParticipant',
      UserIdentity: {
        $class: 'CKUserIdentity',
        UserRecordID: id ? { $class: 'CKRecordID', RecordName: id } : null,
        NameComponents: given
          ? {
              $class: 'NSPersonNameComponents',
              'NS.nameComponentsPrivate': {
                $class: '_NSPersonNameComponentsData',
                'NS.givenName': given,
                'NS.familyName': family,
              },
            }
          : null,
        LookupInfo: {
          $class: 'CKUserIdentityLookupInfo',
          EmailAddress: email ?? null,
          PhoneNumber: phone ?? null,
        },
      },
    })),
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
 * are entries in `$objects`, referred to by index.
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
    if (typeof value === 'string') return push(value);
    if (Array.isArray(value))
      return push({ 'NS.objects': value.map(item => add(item)), $class: classOf('NSArray') });
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
