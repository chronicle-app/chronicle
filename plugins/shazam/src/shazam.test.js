import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monthKey } from '@chronicle.app/etl';
import { writeSchemaDatabase } from '@chronicle.app/etl-sqlite';
import { ShazamExtractor, ShazamTransformer } from '../dist/index.js';
import { account, writeShazamFixture } from './fixture.test-helper.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'shazam-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return writeShazamFixture(dir);
}

// An explicit account keeps the host's iCloud account out of the test, and
// without linkArtists nothing reaches Apple Music.
async function extract(t, config = {}) {
  const extractor = new ShazamExtractor({ input: fixture(t), account, limit: 0, ...config });
  try {
    await extractor.setup();
    return {
      records: await Array.fromAsync(extractor.extract()),
      count: await extractor.determineCount(),
    };
  } finally {
    await extractor.teardown();
  }
}

async function survey(t, config = {}, options = {}) {
  const extractor = new ShazamExtractor({ input: fixture(t), account, ...config });
  try {
    await extractor.setup();
    return await extractor.survey(options);
  } finally {
    await extractor.teardown();
  }
}
const surveyBy = t => survey(t, {}, { byMonth: true });

test('its declared schema is all its queries read, and a ShazamLibrary.sqlite without it is refused', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'shazam-schema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const [schema] = ShazamExtractor.databases;
  const run = async (input, read) => {
    const extractor = new ShazamExtractor({ input, account, limit: 0 });
    try {
      await extractor.setup();
      return await read(extractor);
    } finally {
      await extractor.teardown();
    }
  };
  const records = input => run(input, extractor => Array.fromAsync(extractor.extract()));
  const input = join(dir, 'ShazamLibrary.sqlite');
  writeSchemaDatabase(input, schema, { optional: false });
  assert.deepEqual(await records(input), []);
  assert.equal((await run(input, extractor => extractor.survey())).listens.count, 0);

  // An older Shazam's, say, without a column its queries read.
  const older = join(dir, 'older.sqlite');
  const tracks = schema.tables.ZSHTRACKMO.filter(column => column !== 'ZRAWSONGRESPONSE');
  writeSchemaDatabase(older, { tables: { ZSHTRACKMO: tracks } });
  await assert.rejects(records(older), {
    message: /version of the database/,
    fields: { path: older, missing: ['ZSHTRACKMO.ZRAWSONGRESPONSE'] },
  });
});

const distinct = values => new Set(values.filter(value => value !== null)).size;

const transformer = new ShazamTransformer();
const transform = async record => (await transformer.performTransform(record))[0].data;

test('each Shazam is extracted once, newest first, as a ListenAction of its song', async t => {
  const { records, count } = await extract(t);
  assert.deepEqual(
    records.map(record => record.data.recognitionID),
    ['SYNC-4', 'RECOGNITION-2', 'RECOGNITION-1']
  );
  assert.equal(count, 3);
  for (const record of records) {
    const action = await transform(record);
    assert.equal(action['@type'], 'ListenAction');
    assert.equal(action.agent.sourceId, account.dsid);
    assert.equal(action.object['@type'], 'MusicRecording');
  }

  // An artist linked on Apple Music is keyed by its ID.
  const linked = { ...records[0], data: { ...records[0].data } };
  linked.data.appleMusicArtist = { id: '4001', name: 'Example Artist' };
  const { object } = await transform(linked);
  assert.deepEqual(
    object.artist.map(artist => [artist.source, artist.sourceId]),
    [['apple-music', '4001']]
  );
});

test('a survey counts the Shazams a run reads, when, and their songs and artists', async t => {
  const { records } = await extract(t);
  const times = records.map(record => Date.parse(record.data.date));
  assert.deepEqual(await survey(t, { limit: 1 }), {
    listens: {
      count: records.length,
      earliest: new Date(Math.min(...times)),
      latest: new Date(Math.max(...times)),
      measures: [
        { key: 'songs', label: 'songs', value: distinct(records.map(r => r.data.shazamKey)) },
        { key: 'artists', label: 'artists', value: distinct(records.map(r => r.data.subtitle)) },
      ],
    },
  });
  // By month when asked, by when each song was recognized, in local time.
  const months = {};
  for (const time of times)
    months[monthKey(new Date(time))] = (months[monthKey(new Date(time))] ?? 0) + 1;
  assert.deepEqual((await surveyBy(t)).listens.byMonth, months);
  const since = new Date(Math.min(...times));
  assert.equal(
    (await survey(t, { since })).listens.count,
    (await extract(t, { since })).records.length
  );
});
