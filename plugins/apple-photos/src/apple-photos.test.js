import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// An explicit account keeps the host's iCloud account out of the test.
async function extract(t, Extractor, { model } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-photos-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = writeApplePhotosFixture(dir, { model });
  const extractor = new Extractor({ ...files, account, limit: 0 });
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
// Who an agent or recipient is: you, or a handle with the participants it's the same as.
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
  assert.deepEqual(instruments[ids.camera], [
    ['ProductModel', 'exif', 'Apple iPhone 14 Pro', 'Apple iPhone 14 Pro'],
  ]);
  assert.deepEqual(instruments[ids.local], instruments[ids.camera]);
  // A model that already names its make isn't named twice.
  assert.deepEqual(instruments[ids.unliked], [
    ['ProductModel', 'exif', 'Canon EOS R6', 'Canon EOS R6'],
  ]);
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
  assert.equal(photo.aiDescription, 'A table with breakfast food');
  assert.deepEqual(photo.tags, ['family', 'porch']);
  // Labels from Photos' search, without its own placeholders, synonyms, or places.
  assert.deepEqual(photo.category, ['Food', 'Table']);
  assert.equal(photo.width, 4032);
  assert.equal(photo.height, 3024);
  assert.equal(photo.mimeType, 'image/heic');
  // The people you named: you, and someone merged into another person, as that
  // person. Someone unnamed and a pet are left out.
  assert.deepEqual(
    photo.depicts.map(person => [person.sourceId, person.name, person.sameAs]),
    [
      [people.me, 'Alex Doe', ['@me']],
      [people.sam, 'Sam Lee', undefined],
    ]
  );
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
  // Each run is the library as it is now, so the lists close when one empties.
  assert.deepEqual(photo['@asserts'], ['isPartOf', 'tags', 'depicts', 'category', '*']);

  // Where it was taken, with Photos' address on one line.
  assert.deepEqual(byId.get(ids.camera).location, {
    '@type': 'Location',
    '@asserts': ['*'],
    latitude: 43.6532,
    longitude: -79.3832,
    address: '1 Front St W, Toronto ON M5J 2X5, Canada',
  });
  // Or the postal address's parts. No position, or 0, 0, is no location.
  assert.equal(byId.get(ids.faceTime).location.address, '10 Downing St, London, United Kingdom');
  assert.equal(byId.get(ids.video).location, undefined);
  assert.equal(byId.get(ids.local).location, undefined);

  // A video, and its AI caption.
  const video = media(byId.get(ids.video));
  assert.equal(video.duration, 'PT12.5S');
  assert.equal(video.mimeType, 'video/quicktime');
  assert.equal(video.aiDescription, 'A person walking a dog');
  assert.equal(video.isPartOf[0].sourceId, albums.food);

  // What FaceTime recorded is the clip, which contains the still.
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

test('favorites lists the favorites the change log has no date for, as one record', async t => {
  const { records, outputs } = await extract(t, ApplePhotosFavoritesExtractor);
  assert.equal(outputs.length, 1);
  const [reading] = outputs;
  // A record is an action, so the list arrives on the reading that saw it,
  // dated when the library last changed.
  assert.equal(reading['@type'], 'UpdateAction');
  assert.deepEqual(reading['@key'], ['@type', 'source', 'object.sourceId', 'timestamp']);
  assert.equal(reading.timestamp.toISOString(), records[0].extraction.assertedAt);
  assert.ok(isYou(reading.agent));
  assert.equal(reading.agent.likes, undefined);
  const favorites = reading.object;
  assert.ok(isYou(favorites));
  assert.deepEqual(favorites.sameAs, ['@me']);
  // The video's like has a date, so it's in activity instead.
  assert.deepEqual(favorites.likes, [
    {
      '@type': 'ImageObject',
      '@key': ['@type', 'source', 'sourceId'],
      '@asserts': ['*'],
      source: 'apple-photos',
      sourceId: ids.camera,
    },
  ]);
  // The list is complete, even when it's empty.
  assert.deepEqual(favorites['@asserts'], ['likes', '*']);
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
    favorites[0].object.likes.map(photo => photo.sourceId),
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
      action.recipient?.map(who),
      action.timestamp.toISOString(),
    ]),
    [
      [
        attachments.received,
        'ImageObject',
        'apple-photos:friend@example.com>Agent:icloud:friend@example.com',
        ['you'],
        at.day(40),
      ],
      // You sent it to the one person in the conversation.
      [
        attachments.sent,
        'ImageObject',
        'you',
        ['apple-photos:friend@example.com>Agent:icloud:friend@example.com'],
        at.day(39),
      ],
      [
        attachments.group,
        'VideoObject',
        'apple-photos:member@example.com>Agent:icloud:member@example.com',
        ['you'],
        at.day(38),
      ],
      // Who's in a group isn't known.
      [attachments.groupSent, 'ImageObject', 'you', undefined, at.day(37)],
      // An SMS sender is a phone number in the `phone` namespace, as iMessage has it.
      [
        attachments.sms,
        'ImageObject',
        'apple-photos:+15555550123>Agent:phone:+15555550123',
        ['you'],
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
  // What the Shared with You library's own analysis found in it.
  assert.equal(received.object.aiDescription, 'Two people at a market');
  assert.deepEqual(
    received.object.depicts.map(person => person.sourceId),
    [people.sam]
  );
  assert.deepEqual(received.object.location, {
    '@type': 'Location',
    '@asserts': ['*'],
    latitude: 45.5017,
    longitude: -73.5673,
  });
});
