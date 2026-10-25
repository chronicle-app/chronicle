import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monthKey } from '@chronicle.app/etl';
import { writeSchemaDatabase } from '@chronicle.app/etl-sqlite';
import {
  ApplePhotosActivityExtractor,
  ApplePhotosFavoritesExtractor,
  ApplePhotosPhotosExtractor,
  ApplePhotosSharedWithYouExtractor,
  ApplePhotosTransformer,
} from '../dist/index.js';
import {
  account,
  albums,
  at,
  attachments,
  ids,
  people,
  writeApplePhotosFixture,
} from './fixture.test-helper.js';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-photos-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fixture = (t, { model } = {}) => writeApplePhotosFixture(tempDir(t), { model });

// An explicit account keeps the host's iCloud account out of the test.
async function extract(t, Extractor, { model, files = fixture(t, { model }), ...config } = {}) {
  const extractor = new Extractor({ ...files, account, limit: 0, ...config });
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  try {
    await extractor.setup();
    const records = await Array.fromAsync(extractor.extract());
    const transformer = new ApplePhotosTransformer();
    const outputs = [];
    for (const record of records) {
      outputs.push(...(await transformer.performTransform(record)).map(output => output.data));
    }
    return { records, outputs, count: await extractor.determineCount(), events };
  } finally {
    await extractor.teardown();
  }
}

const you = { '@type': 'Person', source: 'icloud', sourceId: account.dsid };
const isYou = node =>
  node?.['@type'] === you['@type'] && node.source === you.source && node.sourceId === you.sourceId;
const media = action => action.result ?? action.object;
// Who an agent is: you, or a handle with the participants it's the same as.
const who = node => {
  if (!node) return;
  if (isYou(node)) return 'you';
  const others = node.sameAs?.map(other => `${other['@type']}:${other.source}:${other.handle}`);
  return `${node.source}:${node.handle}>${others}`;
};

test('each photo is what you did to bring it into your library, newest first', async t => {
  const { records, outputs, count } = await extract(t, ApplePhotosPhotosExtractor);
  // Recently Deleted, a burst photo Photos hides, and a shared album's photo are left out.
  assert.deepEqual(
    records.map(record => record.data.id),
    [
      ids.camera,
      ids.video,
      ids.screenshot,
      ids.screenRecording,
      ids.faceTime,
      ids.whatsApp,
      ids.noCamera,
      ids.local,
      ids.unliked,
    ]
  );
  assert.equal(count, 9);
  const byId = new Map(outputs.map(action => [action.sourceId, action]));

  // What you made is dated when you made it, and a save when it was added.
  assert.deepEqual(
    outputs.map(action => [
      action.sourceId,
      action['@type'],
      media(action)['@type'],
      action.timestamp.toISOString(),
    ]),
    [
      [ids.camera, 'PhotographAction', 'ImageObject', at.day(10)],
      [ids.video, 'RecordAction', 'VideoObject', at.day(9)],
      [ids.screenshot, 'ScreenshotAction', 'ImageObject', at.day(8)],
      [ids.screenRecording, 'RecordAction', 'VideoObject', at.day(7)],
      [ids.faceTime, 'RecordAction', 'VideoObject', at.day(6)],
      // Saved from WhatsApp four days after it was taken.
      [ids.whatsApp, 'AddAction', 'ImageObject', at.day(5)],
      [ids.noCamera, 'AddAction', 'VideoObject', at.day(4)],
      [ids.local, 'PhotographAction', 'ImageObject', at.day(3)],
      [ids.unliked, 'PhotographAction', 'ImageObject', at.day(2)],
    ]
  );
  for (const action of outputs) {
    assert.ok(isYou(action.agent), action.sourceId);
    assert.deepEqual(action['@key'], ['@type', 'source', 'sourceId']);
    assert.deepEqual(media(action)['@key'], ['@type', 'source', 'sourceId']);
  }

  // The instrument: the kind of camera, the app that saved it, or FaceTime.
  const instruments = Object.fromEntries(
    outputs.map(action => [
      action.sourceId,
      action.instrument?.map(node => [
        node['@type'],
        node.source,
        node.sourceId ?? node.handle,
        node.name,
      ]),
    ])
  );
  // A camera has no ID, so it's keyed by its name.
  assert.deepEqual(instruments[ids.camera], [
    ['ProductModel', 'exif', undefined, 'Apple iPhone 14 Pro'],
  ]);
  assert.deepEqual(byId.get(ids.camera).instrument[0]['@key'], ['source', 'name']);
  assert.deepEqual(instruments[ids.local], instruments[ids.camera]);
  // A model that already names its make isn't named twice.
  assert.deepEqual(instruments[ids.unliked], [['ProductModel', 'exif', undefined, 'Canon EOS R6']]);
  assert.deepEqual(instruments[ids.whatsApp], [
    ['SoftwareApplication', 'apple-bundle-id', 'net.whatsapp.WhatsApp', 'WhatsApp'],
  ]);
  assert.deepEqual(instruments[ids.faceTime], [
    ['SoftwareApplication', 'apple-bundle-id', 'com.apple.FaceTime', 'FaceTime'],
  ]);
  for (const id of [ids.screenshot, ids.screenRecording, ids.noCamera]) {
    assert.equal(instruments[id], undefined, id);
  }

  // The photo, with what Photos knows about it.
  const photo = media(byId.get(ids.camera));
  assert.equal(photo.name, 'Morning');
  assert.equal(photo.handle, 'IMG_0001.HEIC');
  assert.equal(photo.caption, 'Breakfast on the porch');
  assert.deepEqual(photo.tags, ['family', 'porch']);
  assert.equal(photo.width, 4032);
  assert.equal(photo.height, 3024);
  assert.equal(photo.mimeType, 'image/heic');
  // The people you named in it: Alex, and someone you named in a group of
  // faces, who was merged into another person, as that person. Someone
  // unnamed and a pet are left out.
  assert.deepEqual(
    photo.depicts.map(person => [person.sourceId, person.name]),
    [
      [people.alex, 'Alex Doe'],
      [people.sam, 'Sam Lee'],
    ]
  );
  // A face Photos matched to someone itself isn't one you named.
  assert.equal(media(byId.get(ids.video)).depicts, undefined);
  assert.equal(media(byId.get(ids.whatsApp)).depicts, undefined);
  // Its album, in its folders, keyed by iCloud's IDs. A trashed album is left out.
  const [trips] = photo.isPartOf;
  assert.equal(photo.isPartOf.length, 1);
  assert.deepEqual(
    [trips.sourceId, trips.name, trips.isPartOf[0].sourceId, trips.isPartOf[0].name],
    [albums.trips, 'Trips', albums.family, 'Family']
  );
  assert.equal(trips.isPartOf[0].isPartOf[0].sourceId, albums.archive);
  assert.equal(trips.isPartOf[0].isPartOf[0].isPartOf, undefined);
  // A Live Photo contains its video, which takes the photo's ID.
  assert.deepEqual(photo.contains, [
    {
      '@type': 'VideoObject',
      '@key': ['@type', 'source', 'sourceId'],
      '@asserts': ['*'],
      source: 'apple-photos',
      sourceId: ids.camera,
      duration: 'PT2.5S',
    },
  ]);
  // Each run is the library as it is now: what it has is complete.
  assert.deepEqual(photo['@asserts'], ['*']);
  // The camera's mode it was taken in. A Portrait that's also a Live Photo is
  // the Portrait.
  assert.equal(photo.sourceFormat, 'portrait');
  assert.equal(media(byId.get(ids.video)).sourceFormat, 'sloMo');
  assert.equal(media(byId.get(ids.local)).sourceFormat, 'burst');
  assert.equal(byId.get(ids.faceTime).result.contains[0].sourceFormat, 'livePhoto');
  for (const id of [ids.screenshot, ids.whatsApp, ids.unliked]) {
    assert.equal(media(byId.get(id)).sourceFormat, undefined, id);
  }
  // What its file records about the lens and the exposure, by EXIF's tag names.
  assert.deepEqual(photo.exifData, {
    LensModel: 'iPhone 14 Pro back triple camera 6.86mm f/1.78',
    FocalLength: 6.86,
    FocalLengthIn35mmFilm: 24,
    FNumber: 1.78,
    ExposureTime: 0.008,
    PhotographicSensitivity: 64,
    ExposureBiasValue: 0.07,
    MeteringMode: 5,
    WhiteBalance: 0,
    Flash: 0,
    Orientation: 6,
  });
  // No 35mm equivalent or metering mode, and a flash that fired.
  assert.deepEqual(media(byId.get(ids.unliked)).exifData, {
    LensModel: 'RF50mm F1.8 STM',
    FocalLength: 50,
    FNumber: 1.8,
    ExposureTime: 0.004,
    PhotographicSensitivity: 1250,
    ExposureBiasValue: -0.33,
    WhiteBalance: 1,
    Flash: 1,
    DigitalZoomRatio: 2,
  });
  // A video's settings aren't EXIF. A screenshot has no exposure, so its flash
  // and its upright orientation aren't known, but a saved photo's turn is.
  assert.equal(media(byId.get(ids.video)).exifData, undefined);
  assert.equal(media(byId.get(ids.screenshot)).exifData, undefined);
  assert.deepEqual(media(byId.get(ids.whatsApp)).exifData, { Orientation: 8 });

  // Where it was taken, as the camera recorded it.
  assert.deepEqual(byId.get(ids.camera).location, {
    '@type': 'Location',
    '@asserts': ['*'],
    latitude: 43.6532,
    longitude: -79.3832,
  });
  // No position, or 0, 0, is no location.
  assert.equal(byId.get(ids.video).location, undefined);
  assert.equal(byId.get(ids.local).location, undefined);
  // Someone else took a photo you saved, so where is the photo's, not the save's.
  const saved = byId.get(ids.whatsApp);
  assert.equal(saved.location, undefined);
  assert.deepEqual(saved.object.location, {
    '@type': 'Location',
    '@asserts': ['*'],
    latitude: 36.7213,
    longitude: -4.4214,
  });

  // A video.
  const video = media(byId.get(ids.video));
  assert.equal(video.duration, 'PT12.5S');
  assert.equal(video.mimeType, 'video/quicktime');
  assert.equal(video.isPartOf[0].sourceId, albums.food);

  // What FaceTime recorded is the clip, which contains the still, with the
  // face you added in it.
  const call = byId.get(ids.faceTime).result;
  assert.equal(call.duration, 'PT3S');
  assert.equal(call.contains[0]['@type'], 'ImageObject');
  assert.equal(call.contains[0].sourceId, ids.faceTime);
  assert.equal(call.contains[0].contains, undefined);
  assert.deepEqual(
    call.contains[0].depicts.map(person => person.sourceId),
    [people.sam]
  );

  // A photo not in iCloud is keyed by the library's own ID.
  assert.equal(media(byId.get(ids.local)).sourceId, 'UUID-LOCAL');
});

test('activity dates what you did with each photo, from its dates and the change log', async t => {
  const { outputs, events } = await extract(t, ApplePhotosActivityExtractor);
  assert.deepEqual(
    outputs.map(action => [
      action['@type'],
      action.object.sourceId,
      action.target?.sourceId,
      action.timestamp.toISOString(),
    ]),
    [
      ['UpdateAction', ids.camera, undefined, at.day(22)],
      ['ShareAction', ids.camera, undefined, at.day(21)],
      ['ViewAction', ids.camera, undefined, at.day(20)],
      // Retitled.
      ['UpdateAction', ids.camera, undefined, at.day(19)],
      // Of two albums changed together, the video is in Food now. The
      // screenshot, taken out, is in neither.
      ['AddAction', ids.video, albums.food, at.day(17)],
      ['AddAction', ids.camera, albums.trips, at.day(16)],
      // A favorite from before the change log, unfavorited.
      ['UnlikeAction', ids.local, undefined, at.day(15)],
      // Liked, then unliked.
      ['UnlikeAction', ids.unliked, undefined, at.day(14)],
      ['LikeAction', ids.unliked, undefined, at.day(13)],
      ['LikeAction', ids.video, undefined, at.day(12)],
      // A caption added later. The one WhatsApp's photo came with isn't an edit.
      ['UpdateAction', ids.camera, undefined, at.day(11)],
    ]
  );
  for (const action of outputs) {
    assert.ok(isYou(action.agent));
    assert.deepEqual(
      action['@key'],
      action.target
        ? ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp']
        : ['@type', 'source', 'object.sourceId', 'timestamp']
    );
    assert.deepEqual(Object.keys(action.object).sort(), ['@key', '@type', 'source', 'sourceId']);
  }
  assert.equal(outputs.find(action => action.target)?.target.name, 'Food');
  const liked = outputs.find(
    action => action['@type'] === 'LikeAction' && action.object.sourceId === ids.video
  );
  assert.equal(liked.object['@type'], 'VideoObject');
  assert.deepEqual(
    events.filter(event => event.kind === 'hint'),
    []
  );
});

test('favorites likes each photo the change log has no date for, with no date', async t => {
  const { records, outputs } = await extract(t, ApplePhotosFavoritesExtractor);
  // The video's like has a date, so it's in activity instead.
  assert.deepEqual(
    records.map(record => record.data.id),
    [ids.camera]
  );
  const [like] = outputs;
  assert.equal(outputs.length, 1);
  assert.equal(like['@type'], 'LikeAction');
  // When you liked it isn't known, so it's keyed by the photo alone, and
  // read as of when the library last changed.
  assert.deepEqual(like['@key'], ['@type', 'source', 'object.sourceId']);
  assert.equal(like.timestamp, undefined);
  assert.equal(like['@assertedAt'], records[0].extraction.assertedAt);
  assert.ok(isYou(like.agent));
  assert.deepEqual(like.object, {
    '@type': 'ImageObject',
    '@key': ['@type', 'source', 'sourceId'],
    '@asserts': ['*'],
    source: 'apple-photos',
    sourceId: ids.camera,
  });
});

test('a library whose model doesn’t read still gives its dates, and says what it left out', async t => {
  const { outputs, events } = await extract(t, ApplePhotosActivityExtractor, { model: false });
  assert.deepEqual([...new Set(outputs.map(action => action['@type']))].sort(), [
    'ShareAction',
    'UpdateAction',
    'ViewAction',
  ]);
  const hints = events.filter(event => event.kind === 'hint');
  assert.equal(hints.length, 1);
  assert.match(hints[0].hint.action, /Update Chronicle/);

  // Every favorite is then one with no date.
  const { outputs: favorites } = await extract(t, ApplePhotosFavoritesExtractor, { model: false });
  assert.deepEqual(
    favorites.map(like => like.object.sourceId),
    [ids.camera, ids.video]
  );
});

test('shared with you credits each photo to who sent it in Messages', async t => {
  const { records, outputs } = await extract(t, ApplePhotosSharedWithYouExtractor);
  // An image with no camera data, and a photo whose message is gone, are left out.
  assert.deepEqual(
    records.map(record => record.data.attachment),
    [
      attachments.received,
      attachments.sent,
      attachments.group,
      attachments.groupSent,
      attachments.sms,
    ]
  );
  assert.deepEqual(
    outputs.map(action => [
      action.sourceId,
      action.object['@type'],
      who(action.agent),
      action.timestamp.toISOString(),
    ]),
    [
      [
        attachments.received,
        'ImageObject',
        'apple-photos:friend@example.com>Agent:icloud:friend@example.com',
        at.day(40),
      ],
      [attachments.sent, 'ImageObject', 'you', at.day(39)],
      [
        attachments.group,
        'VideoObject',
        'apple-photos:member@example.com>Agent:icloud:member@example.com',
        at.day(38),
      ],
      [attachments.groupSent, 'ImageObject', 'you', at.day(37)],
      // An SMS sender is a phone number in the `phone` namespace, as iMessage has it.
      [
        attachments.sms,
        'ImageObject',
        'apple-photos:+15555550123>Agent:phone:+15555550123',
        at.day(36),
      ],
    ]
  );

  const [received] = outputs;
  assert.deepEqual(received['@key'], ['@type', 'source', 'sourceId']);
  assert.equal(received.object.sourceId, attachments.received);
  // The same attachment as the iMessage plugin keys it.
  assert.deepEqual(received.object.sameAs, [
    {
      '@type': 'ImageObject',
      '@key': ['source', 'sourceId'],
      '@asserts': ['*'],
      source: 'imessage',
      sourceId: attachments.received,
    },
  ]);
  assert.equal(received.object.handle, 'IMG_1001.JPG');
  // Photos matched Sam's face in it itself, so it depicts no one.
  assert.equal(received.object.depicts, undefined);
  assert.deepEqual(received.object['@asserts'], ['*']);
  assert.deepEqual(received.object.location, {
    '@type': 'Location',
    '@asserts': ['*'],
    latitude: 45.5017,
    longitude: -73.5673,
  });
});

async function survey(files, Extractor, config = {}, options = {}) {
  const extractor = new Extractor({ ...files, account, ...config });
  try {
    await extractor.setup();
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}

/** How many of the times each month holds, as a survey's `byMonth` keys them. */
function monthsOf(times) {
  const months = {};
  for (const time of times) months[monthKey(time)] = (months[monthKey(time)] ?? 0) + 1;
  return months;
}

// The kinds a survey dates each record of, by the record type each surveys.
const dated = [
  [ApplePhotosPhotosExtractor, 'photos'],
  [ApplePhotosActivityExtractor, 'activity'],
  [ApplePhotosSharedWithYouExtractor, 'shared-with-you'],
];

test('a survey counts what each kind reads, and when, by month, and since a date', async t => {
  const files = fixture(t);
  for (const [Extractor, kind] of dated) {
    const { records, outputs } = await extract(t, Extractor, { files });
    const times = outputs.map(action => action.timestamp);
    assert.ok(records.length > 1, kind);
    // Not the limit, which a run stops at.
    assert.deepEqual(
      await survey(files, Extractor, { limit: 1 }),
      {
        [kind]: {
          count: records.length,
          earliest: new Date(Math.min(...times)),
          latest: new Date(Math.max(...times)),
        },
      },
      kind
    );
    // By month when asked, by the same times.
    assert.deepEqual(
      (await survey(files, Extractor, {}, { byMonth: true }))[kind].byMonth,
      monthsOf(times),
      kind
    );
    // Since a date, the records a run reads since it.
    const since = times[Math.floor(times.length / 2)];
    const after = await extract(t, Extractor, { files, since });
    assert.ok(after.records.length < records.length, kind);
    assert.equal(
      (await survey(files, Extractor, { since }))[kind].count,
      after.records.length,
      kind
    );
  }
});

test('a survey of favorites counts them, as of when the library last changed', async t => {
  const files = fixture(t);
  const { records } = await extract(t, ApplePhotosFavoritesExtractor, { files });
  const asOf = new Date(records[0].extraction.assertedAt);
  assert.deepEqual(await survey(files, ApplePhotosFavoritesExtractor, { limit: 0 }), {
    favorites: { count: records.length, asOf },
  });
  // None since after the library last changed.
  const since = new Date(asOf.getTime() + 1);
  assert.deepEqual(await survey(files, ApplePhotosFavoritesExtractor, { since }), {
    favorites: { count: 0 },
  });
});

test('its declared schema is all a run and a survey read, and a library without it is refused', async t => {
  const [schema] = ApplePhotosPhotosExtractor.databases;
  const library = (name, tables) => {
    const input = join(tempDir(t), name);
    mkdirSync(join(input, 'database'), { recursive: true });
    writeSchemaDatabase(join(input, 'database', 'Photos.sqlite'), tables, { optional: false });
    return input;
  };
  const { messages } = fixture(t);
  const bare = library('Photos Library.photoslibrary', schema);
  const files = { input: bare, syndication: bare, messages };
  for (const [Extractor, kind] of dated) {
    assert.deepEqual((await extract(t, Extractor, { files })).records, [], kind);
    assert.equal((await survey(files, Extractor))[kind].count, 0, kind);
  }
  assert.deepEqual((await extract(t, ApplePhotosFavoritesExtractor, { files })).records, []);
  assert.equal((await survey(files, ApplePhotosFavoritesExtractor)).favorites.count, 0);

  // An older Photos', say, without a column its queries read.
  const people = schema.tables.ZPERSON.filter(column => column !== 'ZFULLNAME');
  const older = library('Older.photoslibrary', {
    tables: { ...schema.tables, ZPERSON: people },
  });
  await assert.rejects(
    extract(t, ApplePhotosPhotosExtractor, { files: { ...files, input: older } }),
    {
      message: /version of the database/,
      fields: { path: join(older, 'database', 'Photos.sqlite'), missing: ['ZPERSON.ZFULLNAME'] },
    }
  );
  // And a folder of something else isn't a library at all.
  const other = library('Other.photoslibrary', { tables: { ZOTHER: ['Z_PK'] } });
  await assert.rejects(
    extract(t, ApplePhotosPhotosExtractor, { files: { ...files, input: other } }),
    {
      message: /isn’t the database/,
    }
  );
});
