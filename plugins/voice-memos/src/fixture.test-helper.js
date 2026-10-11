import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
const JAN_1 = 757_382_400;

export const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

/** The fixture's recordings by what each one covers, with its UUID. */
export const ids = {
  deleted: '00000000-0000-4000-8000-000000000007',
  runs: '00000000-0000-4000-8000-000000000001',
  inline: '00000000-0000-4000-8000-000000000002',
  empty: '00000000-0000-4000-8000-000000000003',
  qta: '00000000-0000-4000-8000-000000000004',
  noPath: '00000000-0000-4000-8000-000000000005',
  notDownloaded: '00000000-0000-4000-8000-000000000006',
  old: '00000000-0000-4000-8000-000000000008',
};

const WORDS = [
  ['Remember ', 0.2, 0.7],
  ['the ', 0.7, 0.9],
  ['blue ', 0.9, 1.3],
  ['kettle.', 1.3, 2.1],
];

/**
 * A synthetic Voice Memos library: CloudRecordings.db, with Voice Memos'
 * ZCLOUDRECORDING table, and audio files beside it with no real audio.
 *
 * - runs: an `.m4a` whose transcript lists its runs and an attribute table,
 *   recorded on an iPhone. Its media data comes before the movie header.
 * - inline: an `.m4a` whose transcript gives each run's attributes inline,
 *   with a 64-bit media data box.
 * - empty: an `.m4a` whose transcript heard no speech.
 * - qta: a `.qta` with its transcript in its first track's QuickTime metadata,
 *   and no encoder tag.
 * - noPath: a row with no file name, as for a recording with no local audio.
 * - notDownloaded: an empty file, as iCloud leaves before downloading one.
 * - deleted: the newest recording, in Recently Deleted.
 * - old: an `.m4a` from before transcripts, with an `iOS` encoder tag.
 */
export function writeVoiceMemosFixture(dir) {
  const input = join(dir, 'CloudRecordings.db');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE ZCLOUDRECORDING ( Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, Z_OPT INTEGER,
      ZAUDIOFUTUREFLAGS INTEGER, ZFLAGS INTEGER, ZSHAREDFLAGS INTEGER,
      ZSILENCEREMOVERENABLED INTEGER, ZSKIPSILENCEENABLED INTEGER, ZSTUDIOMIXENABLED INTEGER,
      ZFOLDER INTEGER, ZDATE TIMESTAMP, ZDURATION FLOAT, ZEVICTIONDATE TIMESTAMP,
      ZLOCALDURATION FLOAT, ZMTLAYERMIX FLOAT, ZPLAYBACKPOSITION FLOAT, ZPLAYBACKRATE FLOAT,
      ZPLAYBACKSPEED FLOAT, ZSTUDIOMIXLEVEL FLOAT, ZCUSTOMLABEL VARCHAR,
      ZCUSTOMLABELFORSORTING VARCHAR, ZENCRYPTEDTITLE VARCHAR, ZPATH VARCHAR, ZUNIQUEID VARCHAR,
      ZAUDIOFUTUREUUIDS BLOB, ZAUDIODIGEST BLOB, ZAUDIOFUTURE BLOB, ZMTAUDIOFUTURE BLOB,
      ZVERSIONEDAUDIOFUTURE BLOB );
  `);

  const iPhone = 'com.apple.VoiceMemos (iPhone Version 18.3 (Build 22D63))';
  const recordings = [
    {
      id: ids.deleted,
      ZDATE: JAN_1 + 700,
      ZDURATION: 30,
      ZEVICTIONDATE: JAN_1 + 740,
      ZFLAGS: 4,
      ZENCRYPTEDTITLE: 'New Recording 7',
      file: m4a({ encoder: iPhone }),
    },
    {
      id: ids.runs,
      ZDATE: JAN_1 + 600,
      ZDURATION: 12.75,
      ZFLAGS: 1540,
      ZENCRYPTEDTITLE: 'Kettle Reminder',
      file: m4a({ encoder: iPhone, transcript: runsTranscript(), mdatFirst: true }),
    },
    {
      id: ids.inline,
      ZDATE: JAN_1 + 500,
      ZDURATION: 8.5,
      ZFLAGS: 1540,
      ZENCRYPTEDTITLE: 'Garden Street',
      file: m4a({
        encoder: 'com.apple.VoiceMemos (Watch Version 11.3 (Build 22S555))',
        transcript: inlineTranscript(),
        largeMdat: true,
      }),
    },
    {
      id: ids.empty,
      ZDATE: JAN_1 + 400,
      ZDURATION: 1.2,
      ZFLAGS: 516,
      ZENCRYPTEDTITLE: 'New Recording 3',
      file: m4a({ encoder: iPhone, transcript: JSON.stringify({ attributedString: '' }) }),
    },
    {
      id: ids.qta,
      ZDATE: JAN_1 + 300,
      ZDURATION: 35.25,
      ZFLAGS: 5636,
      ZENCRYPTEDTITLE: 'New Recording 2',
      extension: 'qta',
      file: qta({ transcript: runsTranscript() }),
    },
    {
      id: ids.noPath,
      ZDATE: JAN_1 + 200,
      ZDURATION: 0,
      ZFLAGS: 0,
      ZENCRYPTEDTITLE: 'New Recording',
      noPath: true,
    },
    {
      id: ids.notDownloaded,
      ZDATE: JAN_1 + 100,
      ZDURATION: 21.9,
      ZFLAGS: 4,
      ZENCRYPTEDTITLE: 'Bus Stop',
      file: Buffer.alloc(0),
    },
    {
      id: ids.old,
      ZDATE: JAN_1 - 400_000_000,
      ZDURATION: 64.3,
      ZFLAGS: 4,
      ZENCRYPTEDTITLE: '2012-04-30, 9:15 AM',
      file: m4a({ encoder: 'com.apple.VoiceMemos (iOS)' }),
    },
  ];

  for (const [i, { id, file, noPath, extension = 'm4a', ...row }] of recordings.entries()) {
    // Voice Memos names a file after the local start time and the UUID's start.
    const local = new Date((row.ZDATE + 978_307_200) * 1000).toISOString();
    const stamp = `${local.slice(0, 10).replaceAll('-', '')} ${local.slice(11, 19).replaceAll(':', '')}`;
    const name = `${stamp}-${id.slice(0, 8)}.${extension}`;
    if (file) writeFileSync(join(dir, name), file);
    insert(db, {
      Z_PK: i + 1,
      Z_ENT: 1,
      Z_OPT: 1,
      ZUNIQUEID: id,
      ZPATH: noPath ? null : name,
      ZLOCALDURATION: file?.length ? row.ZDURATION : 0,
      ZCUSTOMLABEL: local.replace(/\.\d+Z$/, 'Z'),
      ...row,
    });
  }
  db.close();
  return input;
}

function insert(db, row) {
  const columns = Object.keys(row);
  db.prepare(
    `INSERT INTO ZCLOUDRECORDING (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  ).run(...Object.values(row));
}

/** A transcript that lists its runs, each with an index into the attribute table. */
function runsTranscript() {
  return JSON.stringify({
    locale: { identifier: 'en_CA', current: 0 },
    attributedString: {
      runs: WORDS.flatMap(([word], i) => [word, i]),
      attributeTable: WORDS.map(([, start, end]) => ({ timeRange: [start, end] })),
    },
  });
}

/** A transcript that gives each run's attributes inline. */
function inlineTranscript() {
  return JSON.stringify({
    attributedString: WORDS.flatMap(([word, start, end]) => [word, { timeRange: [start, end] }]),
    locale: { identifier: 'en_CA', current: 1, preferences: { langs: ['en-CA'] } },
  });
}

// QuickTime boxes: a 32-bit size, a four-character type, then the contents.

function box(type, ...contents) {
  const body = Buffer.concat(contents);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  (typeof type === 'string' ? Buffer.from(type, 'latin1') : type).copy(header, 4);
  return Buffer.concat([header, body]);
}

/** A box with a 64-bit size: a 32-bit size of 1, the type, then the size. */
function largeBox(type, ...contents) {
  const body = Buffer.concat(contents);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1, 0);
  header.write(type, 4, 'latin1');
  header.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([header, body]);
}

const u32 = value => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};
const text = value => Buffer.from(value, 'utf8');

// Stand-ins for the boxes a reader walks past.
const mvhd = () => box('mvhd', Buffer.alloc(100));
const tkhd = () => box('tkhd', Buffer.alloc(84));
const mdia = () => box('mdia', box('mdhd', Buffer.alloc(24)), box('hdlr', Buffer.alloc(25)));
const mdat = () => box('mdat', Buffer.from([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]));

/** A metadata item's value: a type word (1, UTF-8), a locale word, then the value. */
const data = value => box('data', u32(1), u32(0), value);

/**
 * An `.m4a` as Voice Memos writes it: the transcript in the audio track's
 * `udta/tsrp`, and the tags in the movie's `udta/meta`, an ISO `meta` box.
 */
function m4a({ encoder, transcript, mdatFirst = false, largeMdat = false }) {
  const tags = box(
    'udta',
    box('date', text('2025-01-01T00:10:00Z')),
    box(
      'meta',
      u32(0),
      box('hdlr', Buffer.alloc(8), text('mdirappl'), Buffer.alloc(10)),
      box(
        'ilst',
        box('©nam', data(text('Tags Name'))),
        ...(encoder ? [box('©too', data(text(encoder)))] : [])
      )
    )
  );
  const trak = box(
    'trak',
    tkhd(),
    mdia(),
    ...(transcript ? [box('udta', box('tsrp', text(transcript)))] : [])
  );
  const moov = box('moov', mvhd(), trak, tags);
  const media = largeMdat ? largeBox('mdat', Buffer.from([0x21, 0x10, 0x04, 0x60])) : mdat();
  const ftyp = box('ftyp', text('M4A '), u32(0), text('M4A isommp42'));
  return Buffer.concat(mdatFirst ? [ftyp, media, moov] : [ftyp, moov, media]);
}

/**
 * A `.qta`: a QuickTime movie whose first track keeps the transcript in a
 * QuickTime `meta` box (no version word), under an `mdta` key, beside
 * another key.
 */
function qta({ transcript }) {
  const keys = ['com.apple.quicktime.track-name', 'com.apple.VoiceMemos.tsrp'];
  const keysBox = box(
    'keys',
    u32(0),
    u32(keys.length),
    ...keys.map(key => Buffer.concat([u32(8 + Buffer.byteLength(key)), text('mdta'), text(key)]))
  );
  const meta = box(
    'meta',
    box('hdlr', Buffer.alloc(8), text('mdta'), Buffer.alloc(14)),
    keysBox,
    box('ilst', box(u32(1), data(text('Main'))), box(u32(2), data(text(transcript))))
  );
  const moov = box('moov', mvhd(), box('trak', tkhd(), mdia(), meta), box('trak', tkhd(), mdia()));
  const ftyp = box('ftyp', text('qt  '), u32(0), text('qt  '));
  return Buffer.concat([ftyp, box('wide'), mdat(), moov]);
}
