import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateRawSync } from 'node:zlib';
import { Uid } from '@chronicle.app/apple';

// Seconds since the Apple epoch; 757382400 is 2025-01-01T00:00:00Z.
const JAN_1 = 757_382_400;
const DAY = 86_400;
const day = n => JAN_1 + n * DAY;

/** An Apple-epoch time as an ISO instant. */
export const iso = seconds => new Date((seconds + 978_307_200) * 1000).toISOString();
export const at = { day: n => iso(day(n)) };

export const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

/** The fixture's photos by what each one covers, with its iCloud ID (or UUID when it has none). */
export const ids = {
  camera: 'CLOUD-CAMERA',
  video: 'CLOUD-VIDEO',
  screenshot: 'CLOUD-SCREENSHOT',
  screenRecording: 'CLOUD-SCREEN-RECORDING',
  faceTime: 'CLOUD-FACETIME',
  whatsApp: 'CLOUD-WHATSAPP',
  noCamera: 'CLOUD-NO-CAMERA',
  local: 'UUID-LOCAL',
  unliked: 'CLOUD-UNLIKED',
  trashed: 'CLOUD-TRASHED',
  burst: 'CLOUD-BURST',
  sharedAlbum: 'CLOUD-SHARED-ALBUM',
};

/** The Shared with You photos, by Messages' attachment ID. */
export const attachments = {
  received: 'at_0_RECEIVED',
  sent: 'at_0_SENT',
  group: 'at_0_GROUP',
  groupSent: 'at_0_GROUP_SENT',
  sms: 'at_0_SMS',
  sticker: 'at_0_STICKER',
  gone: 'at_0_GONE',
};

export const people = {
  me: 'PERSON-ALEX',
  sam: 'PERSON-SAM',
};

export const albums = {
  trips: 'ALBUM-TRIPS',
  food: 'ALBUM-FOOD',
  family: 'FOLDER-FAMILY',
  archive: 'FOLDER-ARCHIVE',
};

/**
 * A synthetic Photos library, the Shared with You library beside it, and a
 * Messages database, with only the tables and columns the plugin reads.
 * Entity numbers aren't Photos' own, so the plugin must read them.
 *
 * Own library (`ZBUNDLESCOPE` 0):
 * - camera: a Live Photo from the iPhone's camera, with no app, with a title,
 *   caption, keywords, AI captions, labels, an address, people (you, someone
 *   merged into another person, someone unnamed, and a pet), and an album in
 *   two folders. An undated favorite, last viewed, shared, and edited.
 * - video: a video from the Camera app, at 0, 0. A favorite the change log dates.
 * - screenshot, screenRecording: captures of the screen.
 * - faceTime: a Live Photo taken during a FaceTime call, with a postal address.
 * - whatsApp: someone's photo saved from WhatsApp, with camera data, and a
 *   caption that came with it.
 * - noCamera: a video no app added and with no camera data.
 * - local: a photo from the Messages camera, not in iCloud, with no position.
 *   Unfavorited after the change log began.
 * - unliked: liked, then unliked.
 * - trashed, burst, sharedAlbum: in Recently Deleted, a burst photo Photos
 *   hides, and a photo in a shared album. None is extracted.
 *
 * Shared with You (`ZBUNDLESCOPE` 3), with who sent each in Messages:
 * - received, sent: in a one-to-one iMessage conversation
 * - group, groupSent: in a group conversation, a video and a screenshot
 * - sms: received over SMS
 * - sticker: an image with no camera data, left out
 * - gone: a photo whose message is gone from Messages, left out
 *
 * `model: false` writes a model cache that doesn't read.
 */
export function writeApplePhotosFixture(dir, { model = true } = {}) {
  const input = join(dir, 'Photos Library.photoslibrary');
  const syndication = join(dir, 'Syndication.photoslibrary');
  const messages = join(dir, 'chat.db');
  writeLibrary(input, { model });
  writeSharedWithYou(syndication);
  writeMessages(messages);
  return { input, syndication, messages };
}

// Entity numbers, as Z_PRIMARYKEY gives them.
const ENT = {
  Asset: 5,
  GenericAlbum: 6,
  Album: 7,
  Folder: 8,
  Moment: 9,
  DetectedFace: 10,
  AssetDescription: 11,
  AdditionalAssetAttributes: 12,
  Keyword: 13,
  Person: 14,
};

/**
 * The fixture's model, each entity with its own properties. Core Data lays
 * out each entity's change bitmask from it, as `coredata.ts` describes:
 *
 * - Asset: to-ones additionalAttributes 0, importSession 1, moment 2; an
 *   entity slot for importSession, whose GenericAlbum has subentities, 3; an
 *   ordering slot for moment, whose inverse is ordered, 4; attributes addedDate
 *   5, dateCreated 6, favorite 7, latitude 8, uuid 9 (boundedByRect is
 *   transient); detectedFaces 10, then the many-to-many albums 11.
 * - Album: to-one parentFolder 0; its ordering slot 1; GenericAlbum's
 *   attributes kind 2, title 3, then Album's cachedCount 4; assets 5.
 * - AssetDescription: assetAttributes 0, longDescription 1.
 * - AdditionalAssetAttributes: asset 0, assetDescription 1, lastViewedDate 2,
 *   originalFilename 3, title 4; keywords 5.
 *
 * Slot n is bit 7 - n % 8 of byte n / 8.
 */
const attribute = (name, details = {}) => ({ name, kind: 'attribute', ...details });
const toOne = (name, destination, inverse) => ({ name, kind: 'toOne', destination, inverse });
const toMany = (name, destination, inverse, details = {}) => ({
  name,
  kind: 'toMany',
  destination,
  inverse,
  ...details,
});
const MODEL = [
  {
    name: 'Asset',
    properties: [
      attribute('uuid'),
      attribute('favorite'),
      toMany('albums', 'Album', 'assets'),
      attribute('dateCreated'),
      attribute('boundedByRect', { transient: true }),
      toOne('moment', 'Moment', 'assets'),
      attribute('addedDate'),
      toOne('importSession', 'GenericAlbum', null),
      toMany('detectedFaces', 'DetectedFace', 'assetForFace'),
      attribute('latitude'),
      toOne('additionalAttributes', 'AdditionalAssetAttributes', 'asset'),
    ],
  },
  {
    name: 'GenericAlbum',
    properties: [
      attribute('title'),
      toOne('parentFolder', 'Folder', 'childCollections'),
      attribute('kind'),
    ],
  },
  {
    name: 'Album',
    parent: 'GenericAlbum',
    properties: [toMany('assets', 'Asset', 'albums', { ordered: true }), attribute('cachedCount')],
  },
  {
    name: 'Folder',
    parent: 'GenericAlbum',
    properties: [toMany('childCollections', 'GenericAlbum', 'parentFolder', { ordered: true })],
  },
  { name: 'Moment', properties: [toMany('assets', 'Asset', 'moment', { ordered: true })] },
  { name: 'DetectedFace', properties: [toOne('assetForFace', 'Asset', 'detectedFaces')] },
  {
    name: 'AssetDescription',
    properties: [
      attribute('longDescription'),
      toOne('assetAttributes', 'AdditionalAssetAttributes', 'assetDescription'),
    ],
  },
  {
    name: 'AdditionalAssetAttributes',
    properties: [
      attribute('title'),
      toOne('asset', 'Asset', 'additionalAttributes'),
      attribute('originalFilename'),
      toMany('keywords', 'Keyword', 'assetAttributes'),
      toOne('assetDescription', 'AssetDescription', 'assetAttributes'),
      attribute('lastViewedDate'),
    ],
  },
  {
    name: 'Keyword',
    properties: [
      attribute('title'),
      toMany('assetAttributes', 'AdditionalAssetAttributes', 'keywords'),
    ],
  },
];

// Change bitmasks for the properties the plugin reads, by the layout above.
const MASK = {
  asset: { favorite: [0x01, 0], albums: [0, 0x10], dateCreated: [0x02, 0] },
  album: { assets: [0x04], parentFolderOrder: [0x40] },
  description: { longDescription: [0x40] },
  attributes: { title: [0x08], lastViewedDate: [0x20] },
};

// ZCHANGETYPE
const INSERT = 0;
const UPDATE = 1;

function writeLibrary(root, { model }) {
  const db = openDatabase(join(root, 'database', 'Photos.sqlite'));
  db.exec(`
    CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER PRIMARY KEY, Z_NAME VARCHAR, Z_SUPER INTEGER, Z_MAX INTEGER);
    CREATE TABLE Z_MODELCACHE (Z_CONTENT BLOB);
    CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZUUID VARCHAR, ZCLOUDASSETGUID VARCHAR,
      ZKIND INTEGER, ZKINDSUBTYPE INTEGER, ZBUNDLESCOPE INTEGER, ZTRASHEDSTATE INTEGER,
      ZVISIBILITYSTATE INTEGER, ZDATECREATED TIMESTAMP, ZADDEDDATE TIMESTAMP, ZWIDTH INTEGER,
      ZHEIGHT INTEGER, ZDURATION FLOAT, ZUNIFORMTYPEIDENTIFIER VARCHAR, ZLATITUDE FLOAT,
      ZLONGITUDE FLOAT, ZFAVORITE INTEGER, ZVIDEOCPDURATIONVALUE INTEGER, ZLASTSHAREDDATE TIMESTAMP,
      ZADJUSTMENTTIMESTAMP TIMESTAMP, ZADJUSTMENTSSTATE INTEGER);
    CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER,
      ZASSETDESCRIPTION INTEGER, ZTITLE VARCHAR, ZORIGINALFILENAME VARCHAR,
      ZIMPORTEDBYBUNDLEIDENTIFIER VARCHAR, ZIMPORTEDBYDISPLAYNAME VARCHAR, ZREVERSELOCATIONDATA BLOB,
      ZLASTVIEWEDDATE TIMESTAMP, ZVIDEOCPDURATIONTIMESCALE INTEGER, ZSYNDICATIONIDENTIFIER VARCHAR);
    CREATE TABLE ZASSETDESCRIPTION (Z_PK INTEGER PRIMARY KEY, ZASSETATTRIBUTES INTEGER, ZLONGDESCRIPTION VARCHAR);
    CREATE TABLE ZEXTENDEDATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZCAMERAMAKE VARCHAR, ZCAMERAMODEL VARCHAR);
    CREATE TABLE ZKEYWORD (Z_PK INTEGER PRIMARY KEY, ZTITLE VARCHAR);
    CREATE TABLE Z_13ASSETATTRIBUTES (Z_12ASSETATTRIBUTES INTEGER, Z_13KEYWORDS INTEGER);
    CREATE TABLE ZGENERICALBUM (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER, ZKIND INTEGER, ZTITLE VARCHAR,
      ZCLOUDGUID VARCHAR, ZUUID VARCHAR, ZPARENTFOLDER INTEGER, ZTRASHEDSTATE INTEGER);
    CREATE TABLE Z_7ASSETS (Z_7ALBUMS INTEGER, Z_5ASSETS INTEGER);
    CREATE TABLE ZPERSON (Z_PK INTEGER PRIMARY KEY, ZPERSONUUID VARCHAR, ZFULLNAME VARCHAR,
      ZDETECTIONTYPE INTEGER, ZMERGETARGETPERSON INTEGER, ZISMECONFIDENCE FLOAT);
    CREATE TABLE ZDETECTEDFACE (Z_PK INTEGER PRIMARY KEY, ZASSETFORFACE INTEGER, ZPERSONFORFACE INTEGER);
    CREATE TABLE ATRANSACTION (Z_PK INTEGER PRIMARY KEY, ZTIMESTAMP FLOAT);
    CREATE TABLE ACHANGE (Z_PK INTEGER PRIMARY KEY, ZTRANSACTIONID INTEGER, ZENTITY INTEGER,
      ZENTITYPK INTEGER, ZCHANGETYPE INTEGER, ZCOLUMNS BLOB);
  `);
  const primaryKey = db.prepare('INSERT INTO Z_PRIMARYKEY VALUES (?, ?, ?, 0)');
  for (const [name, ent] of Object.entries(ENT)) {
    const parent = MODEL.find(entity => entity.name === name)?.parent;
    primaryKey.run(ent, name, parent ? ENT[parent] : 0);
  }
  db.prepare('INSERT INTO Z_MODELCACHE VALUES (?)').run(
    model ? modelCache(MODEL) : Buffer.from('not a model')
  );

  const iPhone = ['Apple', 'iPhone 14 Pro'];
  const rows = {
    camera: {
      subtype: 2,
      created: day(10),
      added: day(10) + 60,
      size: [4032, 3024],
      uti: 'public.heic',
      position: [43.6532, -79.3832],
      place: placeData({ addressString: '1 Front St W\nToronto ON M5J 2X5\nCanada' }),
      favorite: 1,
      clip: [2500, 1000],
      title: 'Morning',
      filename: 'IMG_0001.HEIC',
      caption: 'Breakfast on the porch',
      camera: iPhone,
      lastViewed: day(20),
      lastShared: day(21),
      adjusted: day(22),
    },
    video: {
      kind: 1,
      created: day(9),
      added: day(9) + 60,
      size: [1920, 1080],
      duration: 12.5,
      uti: 'com.apple.quicktime-movie',
      position: [0, 0],
      favorite: 1,
      importer: 'com.apple.camera',
      filename: 'IMG_0002.MOV',
      camera: iPhone,
    },
    screenshot: {
      subtype: 10,
      created: day(8),
      added: day(8),
      size: [1179, 2556],
      uti: 'public.png',
      importer: 'com.apple.springboard',
      filename: 'IMG_0003.PNG',
    },
    screenRecording: {
      kind: 1,
      subtype: 103,
      created: day(7),
      added: day(7),
      duration: 30,
      uti: 'public.mpeg-4',
      importer: 'com.apple.replayd',
    },
    faceTime: {
      subtype: 2,
      created: day(6),
      added: day(6) + 5,
      uti: 'public.heic',
      position: [51.5072, -0.1276],
      place: placeData({
        postal: { _street: '10 Downing St', _city: 'London', _country: 'United Kingdom' },
      }),
      clip: [3000, 1000],
      importer: 'com.apple.FTLivePhotoService',
      camera: iPhone,
    },
    whatsApp: {
      created: day(1),
      added: day(5),
      uti: 'public.jpeg',
      importer: 'net.whatsapp.WhatsApp',
      importerName: 'WhatsApp',
      camera: ['samsung', 'SM-S911B'],
      caption: 'Sent from the beach',
    },
    noCamera: { kind: 1, created: day(4) - 3600, added: day(4), duration: 8, uti: 'public.mpeg-4' },
    local: {
      cloud: null,
      created: day(3),
      added: day(3) + 30,
      uti: 'public.jpeg',
      position: [-180, -180],
      importer: 'com.apple.camera.CameraMessagesApp',
      camera: iPhone,
    },
    unliked: {
      created: day(2),
      added: day(2),
      uti: 'public.jpeg',
      camera: ['Canon', 'Canon EOS R6'],
    },
    trashed: { created: day(30), added: day(30), trashed: 1, camera: iPhone },
    burst: { created: day(29), added: day(29), visibility: 2, camera: iPhone },
    sharedAlbum: { created: day(28), added: day(28), scope: 2, camera: iPhone },
  };

  const insertAsset = db.prepare(
    `INSERT INTO ZASSET VALUES (?, ${ENT.Asset}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAttributes = db.prepare(
    'INSERT INTO ZADDITIONALASSETATTRIBUTES VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)'
  );
  const insertDescription = db.prepare('INSERT INTO ZASSETDESCRIPTION VALUES (?, ?, ?)');
  const insertExtended = db.prepare('INSERT INTO ZEXTENDEDATTRIBUTES VALUES (?, ?, ?, ?)');
  const pk = {};
  let next = 1;
  for (const [name, row] of Object.entries(rows)) {
    const id = next++;
    pk[name] = id;
    const cloud = row.cloud === null ? null : ids[name];
    const uuid = row.cloud === null ? ids[name] : `UUID-${name.toUpperCase()}`;
    insertAsset.run(
      id,
      uuid,
      cloud,
      row.kind ?? 0,
      row.subtype ?? 0,
      row.scope ?? 0,
      row.trashed ?? 0,
      row.visibility ?? 0,
      row.created,
      row.added,
      row.size?.[0] ?? 0,
      row.size?.[1] ?? 0,
      row.duration ?? 0,
      row.uti ?? null,
      row.position?.[0] ?? -180,
      row.position?.[1] ?? -180,
      row.favorite ?? 0,
      row.clip?.[0] ?? 0,
      row.lastShared ?? null,
      row.adjusted ?? null,
      row.adjusted ? 1 : 0
    );
    const description = row.caption ? id : null;
    insertAttributes.run(
      id,
      id,
      description,
      row.title ?? null,
      row.filename ?? null,
      row.importer ?? null,
      row.importerName ?? null,
      row.place ?? null,
      row.lastViewed ?? null,
      row.clip?.[1] ?? 0
    );
    if (description) insertDescription.run(id, id, row.caption);
    if (row.camera) insertExtended.run(id, id, ...row.camera);
  }
  // A lone NUL is what Photos leaves for an app with no bundle identifier.
  db.prepare(
    'UPDATE ZADDITIONALASSETATTRIBUTES SET ZIMPORTEDBYBUNDLEIDENTIFIER = ? WHERE Z_PK = ?'
  ).run('\0', pk.noCamera);

  // Keywords, joined from the keyword's side.
  db.exec("INSERT INTO ZKEYWORD VALUES (1, 'porch'), (2, 'family')");
  db.prepare('INSERT INTO Z_13ASSETATTRIBUTES VALUES (?, 1), (?, 2)').run(pk.camera, pk.camera);

  // Albums: Trips in Family in Archive, and Food at the top. Photos' root
  // folder, a trashed album, and a conversation aren't albums you made.
  const album = db.prepare(`INSERT INTO ZGENERICALBUM VALUES (?, ${ENT.Album}, ?, ?, ?, ?, ?, ?)`);
  album.run(1, 3999, null, null, 'UUID-ROOT', null, 0);
  album.run(2, 4000, 'Archive', albums.archive, 'UUID-ARCHIVE', 1, 0);
  album.run(3, 4000, 'Family', albums.family, 'UUID-FAMILY', 2, 0);
  album.run(4, 2, 'Trips', albums.trips, 'UUID-TRIPS', 3, 0);
  album.run(5, 2, 'Food', albums.food, 'UUID-FOOD', 1, 0);
  album.run(6, 2, 'Old', 'ALBUM-OLD', 'UUID-OLD', 1, 1);
  album.run(7, 1509, '+15555550100', null, 'UUID-CONVERSATION', null, 0);
  const member = db.prepare('INSERT INTO Z_7ASSETS VALUES (?, ?)');
  member.run(4, pk.camera);
  member.run(4, pk.whatsApp);
  member.run(5, pk.video);
  member.run(6, pk.camera);

  // People: you, someone merged into another person, someone unnamed, and a pet.
  db.exec(`
    INSERT INTO ZPERSON VALUES
      (1, '${people.me}', 'Alex Doe', 1, NULL, 1),
      (2, 'PERSON-SAM-OLD', 'Sam', 1, 3, 0),
      (3, '${people.sam}', 'Sam Lee', 1, NULL, 0),
      (4, 'PERSON-UNNAMED', '', 1, NULL, 0),
      (5, 'PERSON-REX', 'Rex', 4, NULL, 0);
  `);
  const face = db.prepare(
    'INSERT INTO ZDETECTEDFACE (ZASSETFORFACE, ZPERSONFORFACE) VALUES (?, ?)'
  );
  for (const person of [1, 2, 4, 5]) face.run(pk.camera, person);
  face.run(pk.faceTime, 3);

  // The change log.
  const transaction = db.prepare('INSERT INTO ATRANSACTION VALUES (?, ?)');
  const change = db.prepare(
    'INSERT INTO ACHANGE (ZTRANSACTIONID, ZENTITY, ZENTITYPK, ZCHANGETYPE, ZCOLUMNS) VALUES (?, ?, ?, ?, ?)'
  );
  const log = (tx, time, changes) => {
    transaction.run(tx, time);
    for (const [entity, row, type, mask] of changes) {
      change.run(tx, ENT[entity], row, type, mask ? Buffer.from(mask) : null);
    }
  };
  // WhatsApp's photo arrives with its caption: not an edit.
  log(1, day(5), [
    ['AssetDescription', pk.whatsApp, INSERT],
    ['Asset', pk.whatsApp, INSERT],
  ]);
  // A caption added to the camera photo later.
  log(2, day(11), [['AssetDescription', pk.camera, INSERT]]);
  // The video made a favorite, and the camera photo's date changed.
  log(3, day(12), [
    ['Asset', pk.video, UPDATE, MASK.asset.favorite],
    ['Asset', pk.camera, UPDATE, MASK.asset.dateCreated],
  ]);
  // Liked, then unliked.
  log(4, day(13), [['Asset', pk.unliked, UPDATE, MASK.asset.favorite]]);
  log(5, day(14), [['Asset', pk.unliked, UPDATE, MASK.asset.favorite]]);
  // A favorite from before the change log, unfavorited.
  log(6, day(15), [['Asset', pk.local, UPDATE, MASK.asset.favorite]]);
  // The camera photo added to Trips.
  log(7, day(16), [
    ['Album', 4, UPDATE, [MASK.album.assets[0] + MASK.album.parentFolderOrder[0]]],
    ['Asset', pk.camera, UPDATE, MASK.asset.albums],
  ]);
  // Two albums changed: the video added to Food, and the screenshot taken out
  // of Trips, so it's in neither now.
  log(8, day(17), [
    ['Album', 4, UPDATE, MASK.album.assets],
    ['Album', 5, UPDATE, MASK.album.assets],
    ['Asset', pk.video, UPDATE, MASK.asset.albums],
    ['Asset', pk.screenshot, UPDATE, MASK.asset.albums],
  ]);
  // Only Trips' place in its folder changed, beside WhatsApp's photo's albums.
  log(9, day(18), [
    ['Album', 4, UPDATE, MASK.album.parentFolderOrder],
    ['Asset', pk.whatsApp, UPDATE, MASK.asset.albums],
  ]);
  // The camera photo retitled, and the video viewed.
  log(10, day(19), [
    ['AdditionalAssetAttributes', pk.camera, UPDATE, MASK.attributes.title],
    ['AdditionalAssetAttributes', pk.video, UPDATE, MASK.attributes.lastViewedDate],
  ]);
  db.close();

  writeMediaAnalysis(root, [
    { uuid: 'UUID-CAMERA', table: 'image', caption: 'A plate on a table', confidence: 0.4 },
    {
      uuid: 'UUID-CAMERA',
      table: 'image',
      caption: 'A table with breakfast food',
      confidence: 0.9,
    },
    { uuid: 'UUID-VIDEO', table: 'video', caption: 'A person walking a dog', confidence: 0.8 },
  ]);
  writeSearchIndex(root, [
    { identifier: 'UUID-CAMERA', terms: [1, 2, 3, 4, 5, 1] },
    { identifier: 'uuid-video', terms: [1] },
  ]);
}

function writeSharedWithYou(root) {
  const db = openDatabase(join(root, 'database', 'Photos.sqlite'));
  // An older library: no ZISMECONFIDENCE, no ZCLOUDGUID, no change log.
  db.exec(`
    CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER PRIMARY KEY, Z_NAME VARCHAR, Z_SUPER INTEGER, Z_MAX INTEGER);
    CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZUUID VARCHAR, ZKIND INTEGER, ZKINDSUBTYPE INTEGER,
      ZBUNDLESCOPE INTEGER, ZTRASHEDSTATE INTEGER, ZVISIBILITYSTATE INTEGER, ZDATECREATED TIMESTAMP,
      ZADDEDDATE TIMESTAMP, ZWIDTH INTEGER, ZHEIGHT INTEGER, ZDURATION FLOAT, ZUNIFORMTYPEIDENTIFIER VARCHAR,
      ZLATITUDE FLOAT, ZLONGITUDE FLOAT, ZFAVORITE INTEGER);
    CREATE TABLE ZADDITIONALASSETATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZORIGINALFILENAME VARCHAR,
      ZSYNDICATIONIDENTIFIER VARCHAR);
    CREATE TABLE ZASSETDESCRIPTION (Z_PK INTEGER PRIMARY KEY, ZASSETATTRIBUTES INTEGER, ZLONGDESCRIPTION VARCHAR);
    CREATE TABLE ZEXTENDEDATTRIBUTES (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZCAMERAMAKE VARCHAR, ZCAMERAMODEL VARCHAR);
    CREATE TABLE ZGENERICALBUM (Z_PK INTEGER PRIMARY KEY, ZKIND INTEGER, ZTITLE VARCHAR, ZUUID VARCHAR,
      ZPARENTFOLDER INTEGER, ZTRASHEDSTATE INTEGER);
    CREATE TABLE ZPERSON (Z_PK INTEGER PRIMARY KEY, ZPERSONUUID VARCHAR, ZFULLNAME VARCHAR,
      ZDETECTIONTYPE INTEGER, ZMERGETARGETPERSON INTEGER);
    CREATE TABLE ZDETECTEDFACE (Z_PK INTEGER PRIMARY KEY, ZASSETFORFACE INTEGER, ZPERSONFORFACE INTEGER);
  `);
  db.exec("INSERT INTO Z_PRIMARYKEY VALUES (3, 'Asset', 0, 0)");
  const items = [
    {
      attachment: attachments.received,
      added: day(40),
      position: [45.5017, -73.5673],
      camera: true,
    },
    { attachment: attachments.sent, added: day(39), camera: true },
    { attachment: attachments.group, added: day(38), kind: 1, duration: 4 },
    { attachment: attachments.groupSent, added: day(37), subtype: 10 },
    { attachment: attachments.sms, added: day(36), camera: true },
    { attachment: attachments.sticker, added: day(35) },
    { attachment: attachments.gone, added: day(34), camera: true },
  ];
  const insertAsset = db.prepare(
    'INSERT INTO ZASSET VALUES (?, ?, ?, ?, 3, 0, 0, ?, ?, 0, 0, ?, ?, ?, ?, 0)'
  );
  const insertAttributes = db.prepare('INSERT INTO ZADDITIONALASSETATTRIBUTES VALUES (?, ?, ?, ?)');
  const insertExtended = db.prepare('INSERT INTO ZEXTENDEDATTRIBUTES VALUES (?, ?, ?, ?)');
  for (const [i, item] of items.entries()) {
    const id = i + 1;
    insertAsset.run(
      id,
      `UUID-SHARED-${id}`,
      item.kind ?? 0,
      item.subtype ?? 0,
      item.added - DAY,
      item.added,
      item.duration ?? 0,
      item.kind ? 'public.mpeg-4' : 'public.jpeg',
      item.position?.[0] ?? -180,
      item.position?.[1] ?? -180
    );
    insertAttributes.run(id, id, `IMG_${1000 + id}.JPG`, item.attachment);
    if (item.camera) insertExtended.run(id, id, 'Apple', 'iPhone 15');
  }
  // Sam, by the same ID as in your library, in the photo you received.
  db.exec(`INSERT INTO ZPERSON VALUES (1, '${people.sam}', 'Sam Lee', 1, NULL)`);
  db.exec('INSERT INTO ZDETECTEDFACE (ZASSETFORFACE, ZPERSONFORFACE) VALUES (1, 1)');
  db.close();

  writeMediaAnalysis(root, [
    { uuid: 'UUID-SHARED-1', table: 'image', caption: 'Two people at a market', confidence: 0.7 },
  ]);
}

function writeMessages(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, style INTEGER, chat_identifier TEXT);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, is_from_me INTEGER, service TEXT, handle_id INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT UNIQUE);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);

    INSERT INTO handle VALUES (1, 'friend@example.com', 'iMessage'), (2, '+15555550123', 'SMS'),
      (3, 'member@example.com', 'iMessage');
    INSERT INTO chat VALUES (1, 45, 'friend@example.com'), (2, 43, 'chat123'), (3, 45, '+15555550123');
    INSERT INTO chat_handle_join VALUES (1, 1), (2, 1), (2, 3), (3, 2);
  `);
  const message = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  const inChat = db.prepare('INSERT INTO chat_message_join VALUES (?, ?)');
  const attachment = db.prepare('INSERT INTO attachment VALUES (?, ?)');
  const attach = db.prepare('INSERT INTO message_attachment_join VALUES (?, ?)');
  const sent = [
    // [attachment, from me, service, handle, chat]
    [attachments.received, 0, 'iMessage', 1, 1],
    // A message you send in a one-to-one conversation has no handle of its own.
    [attachments.sent, 1, 'iMessage', 0, 1],
    [attachments.group, 0, 'iMessage', 3, 2],
    [attachments.groupSent, 1, 'iMessage', 0, 2],
    [attachments.sms, 0, 'SMS', 2, 3],
    [attachments.sticker, 0, 'iMessage', 1, 1],
  ];
  for (const [i, [guid, fromMe, service, handle, chat]] of sent.entries()) {
    const id = i + 1;
    message.run(id, fromMe, service, handle);
    inChat.run(chat, id);
    attachment.run(id, guid);
    attach.run(id, id);
  }
  db.close();
}

/** The library's media analysis: the captions Photos' model wrote. */
function writeMediaAnalysis(root, captions) {
  const db = openDatabase(
    join(root, 'private', 'com.apple.mediaanalysisd', 'MediaAnalysis', 'MediaAnalysis.sqlite')
  );
  db.exec(`
    CREATE TABLE ZASSET (Z_PK INTEGER PRIMARY KEY, ZLOCALIDENTIFIER VARCHAR);
    CREATE TABLE ZIMAGECAPTIONRESULT (Z_PK INTEGER PRIMARY KEY, ZISUNSAFE INTEGER, ZASSET INTEGER, ZCONFIDENCE FLOAT, ZCAPTION VARCHAR);
    CREATE TABLE ZVIDEOCAPTIONRESULT (Z_PK INTEGER PRIMARY KEY, ZASSET INTEGER, ZCONFIDENCE FLOAT, ZCAPTION VARCHAR);
  `);
  const asset = db.prepare('INSERT OR IGNORE INTO ZASSET VALUES (?, ?)');
  const image = db.prepare(
    'INSERT INTO ZIMAGECAPTIONRESULT (ZISUNSAFE, ZASSET, ZCONFIDENCE, ZCAPTION) VALUES (0, ?, ?, ?)'
  );
  const video = db.prepare(
    'INSERT INTO ZVIDEOCAPTIONRESULT (ZASSET, ZCONFIDENCE, ZCAPTION) VALUES (?, ?, ?)'
  );
  const pks = new Map();
  for (const { uuid, table, caption, confidence } of captions) {
    if (!pks.has(uuid)) {
      pks.set(uuid, pks.size + 1);
      asset.run(pks.get(uuid), `${uuid}/L0/001`);
    }
    (table === 'video' ? video : image).run(pks.get(uuid), confidence, caption);
  }
  db.close();
}

/**
 * The library's search index: each item lists its search terms as
 * little-endian 32-bit IDs. Category 4000 is a label; type 2 is a synonym.
 */
function writeSearchIndex(root, items) {
  const db = openDatabase(join(root, 'database', 'search', 'leo.sqlite'));
  db.exec(`
    CREATE TABLE items (pk INTEGER PRIMARY KEY, identifier TEXT UNIQUE, type INTEGER, lexeme_ids BLOB);
    CREATE TABLE lexicon (pk INTEGER PRIMARY KEY, lexeme_id INTEGER, type INTEGER, category INTEGER, content TEXT);
    INSERT INTO lexicon (lexeme_id, type, category, content) VALUES
      (1, 1, 4000, 'Food'), (2, 1, 4000, 'Table'), (3, 1, 4000, 'PGSceneSearchableText'),
      (4, 2, 4000, 'Meal'), (5, 1, 2060, 'Toronto');
  `);
  const item = db.prepare('INSERT INTO items (identifier, type, lexeme_ids) VALUES (?, 1, ?)');
  for (const { identifier, terms } of items) {
    const ids = Buffer.alloc(terms.length * 4);
    for (const [i, term] of terms.entries()) ids.writeUInt32LE(term, i * 4);
    item.run(identifier, ids);
  }
  db.close();
}

function openDatabase(path) {
  mkdirSync(join(path, '..'), { recursive: true });
  return new DatabaseSync(path);
}

/** Where a photo was taken, as Photos archives it: a `PLRevGeoLocationInfo`. */
function placeData({ addressString, postal }) {
  const archive = keyedArchive();
  const fields = { version: 13, isHome: false };
  if (addressString) fields.addressString = archive.add(addressString);
  if (postal) {
    fields.postalAddress = archive.object(
      'CNPostalAddress',
      Object.fromEntries(Object.entries(postal).map(([key, value]) => [key, archive.add(value)]))
    );
  }
  return archive.finish(archive.object('PLRevGeoLocationInfo', fields));
}

/**
 * The model a store keeps in `Z_MODELCACHE`: an NSManagedObjectModel,
 * archived with NSKeyedArchiver and compressed with raw deflate. Each
 * entity's archived properties include those it inherits.
 */
function modelCache(entities) {
  const archive = keyedArchive();
  const entityRefs = new Map(
    entities.map(entity => [entity.name, archive.object('NSEntityDescription', {})])
  );
  const propertyRefs = new Map();
  for (const entity of entities) {
    for (const property of entity.properties) {
      const fields = { NSPropertyName: archive.add(property.name) };
      let className = 'NSAttributeDescription';
      if (property.kind === 'attribute') {
        if (property.transient) fields.NSIsTransient = true;
      } else {
        className = 'NSRelationshipDescription';
        fields.NSMaxCount = property.kind === 'toOne' ? 1 : 0;
        fields._NSDestinationEntityName = archive.add(property.destination);
        // An ordered relationship's flags have 1024 set.
        fields._P = property.ordered ? 1267 : 243;
      }
      propertyRefs.set(`${entity.name}.${property.name}`, archive.object(className, fields));
    }
  }
  for (const entity of entities) {
    for (const property of entity.properties) {
      const inverse =
        property.inverse && propertyRefs.get(`${property.destination}.${property.inverse}`);
      const ref = propertyRefs.get(`${entity.name}.${property.name}`);
      archive.objects[ref.index].NSInverseRelationship = inverse ?? new Uid(0);
    }
  }
  const byName = new Map(entities.map(entity => [entity.name, entity]));
  const allProperties = name => {
    const entity = byName.get(name);
    return [
      ...(entity.parent ? allProperties(entity.parent) : []),
      ...entity.properties.map(property => [
        property.name,
        propertyRefs.get(`${name}.${property.name}`),
      ]),
    ];
  };
  const dictionary = entries =>
    archive.object('NSMutableDictionary', {
      'NS.keys': entries.map(([key]) => archive.add(key)),
      'NS.objects': entries.map(([, value]) => value),
    });
  for (const entity of entities) {
    const subentities = entities.filter(other => other.parent === entity.name);
    Object.assign(archive.objects[entityRefs.get(entity.name).index], {
      NSEntityName: archive.add(entity.name),
      NSProperties: dictionary(allProperties(entity.name)),
      NSSuperentity: entity.parent ? entityRefs.get(entity.parent) : new Uid(0),
      NSSubentities: dictionary(subentities.map(sub => [sub.name, entityRefs.get(sub.name)])),
    });
  }
  const root = archive.object('NSManagedObjectModel', {
    NSEntities: dictionary(entities.map(entity => [entity.name, entityRefs.get(entity.name)])),
  });
  return deflateRawSync(archive.finish(root));
}

/** An NSKeyedArchiver archive being built: `$objects`, with references to them. */
function keyedArchive() {
  const objects = ['$null'];
  const classes = new Map();
  const add = value => {
    objects.push(value);
    return new Uid(objects.length - 1);
  };
  const classOf = name => {
    if (!classes.has(name))
      classes.set(name, add({ $classname: name, $classes: [name, 'NSObject'] }));
    return classes.get(name);
  };
  return {
    objects,
    add,
    object: (className, fields) => add({ ...fields, $class: classOf(className) }),
    finish: root =>
      binaryPlist({
        $version: 100_000,
        $archiver: 'NSKeyedArchiver',
        $top: { root },
        $objects: objects,
      }),
  };
}

/**
 * A binary property list (`bplist00`) of a value: null, booleans, numbers,
 * strings, data, archive references (`Uid`), arrays, and objects.
 */
function binaryPlist(root) {
  const objects = [];
  const flatten = value => {
    const index = objects.length;
    objects.push(null);
    if (Array.isArray(value)) objects[index] = { array: value.map(item => flatten(item)) };
    else if (
      value &&
      typeof value === 'object' &&
      !(value instanceof Uint8Array) &&
      !(value instanceof Uid)
    ) {
      const entries = Object.entries(value);
      objects[index] = {
        keys: entries.map(([key]) => flatten(key)),
        values: entries.map(([, v]) => flatten(v)),
      };
    } else objects[index] = { scalar: value };
    return index;
  };
  flatten(root);

  const refSize = objects.length < 256 ? 1 : 2;
  const ref = index => (refSize === 1 ? [index] : [Math.floor(index / 256), index % 256]);
  const marker = (type, count) => {
    if (count < 15) return Buffer.from([type * 16 + count]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(count);
    return Buffer.concat([Buffer.from([type * 16 + 15, 0x12]), size]);
  };
  const encode = ({ scalar, array, keys, values }) => {
    if (array) {
      return Buffer.concat([marker(0xa, array.length), Buffer.from(array.flatMap(i => ref(i)))]);
    }
    if (keys)
      return Buffer.concat([
        marker(0xd, keys.length),
        Buffer.from([...keys, ...values].flatMap(i => ref(i))),
      ]);
    if (scalar === null || scalar === undefined) return Buffer.from([0x00]);
    if (scalar === true) return Buffer.from([0x09]);
    if (scalar === false) return Buffer.from([0x08]);
    if (scalar instanceof Uid)
      return Buffer.from([0x81, Math.floor(scalar.index / 256), scalar.index % 256]);
    if (scalar instanceof Uint8Array) return Buffer.concat([marker(0x4, scalar.length), scalar]);
    if (typeof scalar === 'number') {
      const bytes = Buffer.alloc(9);
      if (Number.isInteger(scalar)) {
        bytes[0] = 0x13;
        bytes.writeBigInt64BE(BigInt(scalar), 1);
      } else {
        bytes[0] = 0x23;
        bytes.writeDoubleBE(scalar, 1);
      }
      return bytes;
    }
    const text = String(scalar);
    // Text with only ASCII characters is written as ASCII.
    if ([...text].every(character => character.codePointAt(0) < 128))
      return Buffer.concat([marker(0x5, text.length), Buffer.from(text, 'latin1')]);
    // UTF-16 big-endian; Node encodes only little-endian.
    return Buffer.concat([marker(0x6, text.length), Buffer.from(text, 'utf16le').swap16()]);
  };

  const chunks = [Buffer.from('bplist00', 'latin1')];
  const offsets = [];
  let size = 8;
  for (const object of objects) {
    const bytes = encode(object);
    offsets.push(size);
    chunks.push(bytes);
    size += bytes.length;
  }
  const table = Buffer.alloc(offsets.length * 4);
  for (const [i, offset] of offsets.entries()) table.writeUInt32BE(offset, i * 4);
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = refSize;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(0n, 16);
  trailer.writeBigUInt64BE(BigInt(size), 24);
  return Buffer.concat([...chunks, table, trailer]);
}
