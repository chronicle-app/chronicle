import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { writeZip } from '@chronicle.app/etl';
import {
  AppleHealthHeartExtractor,
  AppleHealthSleepExtractor,
  AppleHealthTransformer,
  AppleHealthVitalsExtractor,
} from '../dist/index.js';
import { OLD_WATCH, PHONE, WATCH, account, writeHealthExport } from './fixture.test-helper.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'apple-health-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return writeHealthExport(dir);
}

// An explicit account keeps the host's iCloud account out of the test.
async function extract(Extractor, config) {
  const extractor = new Extractor({ account, limit: 0, ...config });
  const events = [];
  extractor.useOutput({ emit: event => events.push(event) });
  await extractor.setup();
  try {
    return { records: await Array.fromAsync(extractor.extract()), events };
  } finally {
    await extractor.teardown();
  }
}

const transformer = new AppleHealthTransformer();

// The values a reading put on you, without what identifies you.
const IDENTITY = new Set(['@type', '@key', 'source', 'sourceId', 'handle', 'sameAs']);
const valuesOf = person =>
  Object.fromEntries(Object.entries(person).filter(([name]) => !IDENTITY.has(name)));
async function transformAll(records) {
  const out = [];
  for (const record of records) {
    for (const result of await transformer.performTransform(record)) out.push(result.data);
  }
  return out;
}

// An instrument as [type, key]: a device by its name, a kind of device by its
// Wikidata ID, an OS release, or an app.
const instruments = action =>
  (action.instrument ?? []).map(node => [node['@type'], node.handle ?? node.sourceId]);
const device = (name, ...release) => [
  ['Device', name],
  ['ProductModel', 'Q18010946'],
  ...release.map(handle => ['OperatingSystem', handle]),
];

test('heart readings become MeasureActions on you, keyed by what they say', async t => {
  const { records } = await extract(AppleHealthHeartExtractor, { input: fixture(t) });
  const actions = await transformAll(records);

  assert.deepEqual(
    actions.map(action => [
      action.timestamp ?? `${action.startTime}/${action.endTime}`,
      action.object,
    ]),
    [
      // A winter reading carries the export's offset, and the instant is still right.
      ['2025-01-15T12:00:00.000Z', { heartRate: 72 }],
      ['2025-01-15T12:00:00.000Z', { heartRate: 72 }],
      ['2025-01-15T12:00:00.000Z', { heartRate: 74 }],
      ['2025-02-01T13:00:00.000Z/2025-02-01T13:05:00.000Z', { heartRate: 64.5 }],
      ['2024-06-01T14:00:00.000Z', { heartRate: 80 }],
      ['2024-12-01T11:00:00.000Z', { heartRate: 61 }],
      ['2025-01-15T04:00:00.000Z/2025-01-16T03:59:00.000Z', { restingHeartRate: 58 }],
      ['2025-01-15T04:00:00.000Z/2025-01-16T03:59:00.000Z', { walkingHeartRate: 97 }],
      ['2025-01-15T07:00:00.000Z/2025-01-15T07:01:00.000Z', { heartRateVariability: 48.25 }],
      ['2025-01-15T22:35:00.000Z', { heartRateRecovery: 31 }],
      // The inconclusive ECG says nothing about the rhythm, so only one is here.
      ['2025-01-20T17:04:55.000Z', { heartRhythm: 'Sinus Rhythm' }],
    ].map(([time, values]) => [
      time,
      {
        '@type': 'Person',
        source: 'icloud',
        sourceId: account.dsid,
        handle: account.email,
        '@key': ['@type', 'source', 'sourceId'],
        sameAs: ['@me'],
        ...values,
      },
    ])
  );

  for (const action of actions) {
    assert.equal(action['@type'], 'MeasureAction');
    assert.equal(action.agent.sourceId, account.dsid);
  }

  // An exact duplicate has the same key. A different value at the same instant doesn't.
  const [first, duplicate, other] = actions;
  assert.equal(first.sourceId, duplicate.sourceId);
  assert.notEqual(first.sourceId, other.sourceId);
  assert.equal(
    first.sourceId,
    `HeartRate|${WATCH}|2025-01-15T12:00:00.000Z|2025-01-15T12:00:00.000Z|72`
  );

  // The same watch under two addresses is one device. Each release is named
  // where the sample names it. A sample that doesn't describe its device
  // takes the device from the rest of the export, without a release.
  assert.deepEqual(instruments(first), device(WATCH, 'watchOS 9.2'));
  assert.deepEqual(instruments(other), device(WATCH, 'watchOS 9.2'));
  assert.deepEqual(instruments(actions[3]), device(WATCH, 'watchOS 10.2'));
  assert.deepEqual(instruments(actions[6]), device(WATCH));
  const watch = first.instrument[0];
  assert.equal(watch.model, 'Watch7,1');
  assert.deepEqual(watch.category, ['watch']);
  // An app is named by its name. The watch's earlier name is another device.
  assert.deepEqual(instruments(actions[4]), [['SoftwareApplication', 'Pulse Pal']]);
  assert.deepEqual(instruments(actions[5]), device(OLD_WATCH, 'watchOS 9.1'));
  // An ECG names the watch's hardware but not the watch.
  assert.deepEqual(instruments(actions[10]), [['ProductModel', 'Q18010946']]);
});

test('vitals convert to their units, and a blood pressure is one reading with both values', async t => {
  const { records, events } = await extract(AppleHealthVitalsExtractor, { input: fixture(t) });
  const actions = await transformAll(records);
  const values = actions.map(({ object }) => valuesOf(object));
  assert.deepEqual(values, [
    { respiratoryRate: 15.5 },
    { oxygenSaturation: 0.97 },
    // 96.8 °F
    { sleepingWristTemperature: 36 },
    { systolicBloodPressure: 118, diastolicBloodPressure: 76 },
  ]);
  const pressure = actions[3];
  assert.equal(pressure.timestamp, '2025-01-15T15:58:00.000Z');
  assert.equal(
    pressure.sourceId,
    'BloodPressure|Health|2025-01-15T15:58:00.000Z|2025-01-15T15:58:00.000Z|118/76'
  );
  assert.deepEqual(instruments(pressure), [['SoftwareApplication', 'Health']]);

  // A sample in a unit there's no conversion for is left out, and the run says so.
  const hints = events.filter(event => event.kind === 'hint');
  assert.equal(hints.length, 1);
  assert.match(hints[0].message, /^1 sample was left out/);
});

test('sleep is grouped into periods per source, each with its stages', async t => {
  const { records } = await extract(AppleHealthSleepExtractor, { input: fixture(t) });
  const actions = await transformAll(records);
  const nights = actions.filter(action => action['@type'] === 'SleepAction');

  // The phone and the watch each have their own night, and the nap is its own period.
  assert.deepEqual(
    nights.map(night => [night.instrument[0].handle, night.startTime, night.endTime]),
    [
      ['Sleep Cycle', '2016-03-02T03:30:00.000Z', '2016-03-02T10:45:00.000Z'],
      [PHONE, '2025-01-15T02:45:00.000Z', '2025-01-15T11:00:00.000Z'],
      [WATCH, '2025-01-15T03:05:00.000Z', '2025-01-15T10:50:00.000Z'],
      [WATCH, '2025-01-15T18:00:00.000Z', '2025-01-15T18:30:00.000Z'],
    ]
  );
  assert.deepEqual(instruments(nights[0]), [['SoftwareApplication', 'Sleep Cycle']]);
  assert.deepEqual(
    instruments(nights[1]).map(([type]) => type),
    ['Device', 'ProductModel']
  );

  const night = nights[2];
  assert.equal(night.result['@type'], 'SleepSession');
  assert.equal(night.sourceId, `${WATCH}|2025-01-15T03:05:00.000Z|2025-01-15T10:50:00.000Z`);

  // The night's stages, each a Session that is part of the night. `in bed`
  // and a stage over the same span are two stages.
  const stages = actions
    .filter(action => action['@type'] === 'ExperienceAction')
    .filter(action => action.result.isPartOf[0].sourceId === night.sourceId);
  assert.deepEqual(
    stages.map(stage => [stage.result.category[0], stage.startTime, stage.endTime]),
    [
      ['in bed', '2025-01-15T03:05:00.000Z', '2025-01-15T10:50:00.000Z'],
      ['core', '2025-01-15T03:20:00.000Z', '2025-01-15T04:10:00.000Z'],
      ['in bed', '2025-01-15T03:20:00.000Z', '2025-01-15T04:10:00.000Z'],
      ['deep', '2025-01-15T04:10:00.000Z', '2025-01-15T04:40:00.000Z'],
      ['REM', '2025-01-15T04:40:00.000Z', '2025-01-15T05:10:00.000Z'],
      ['awake', '2025-01-15T10:30:00.000Z', '2025-01-15T10:50:00.000Z'],
    ]
  );
  for (const stage of stages) {
    assert.equal(stage.result['@type'], 'Session');
    assert.equal(stage.result.isPartOf[0]['@type'], 'SleepSession');
    assert.equal(stage.sourceId, stage.result.sourceId);
  }
  assert.equal(new Set(stages.map(stage => stage.sourceId)).size, stages.length);
});

test('since, until, and limit pick readings by when they started', async t => {
  const input = fixture(t);
  const window = {
    since: new Date('2025-01-15T12:00:00Z'),
    until: new Date('2025-01-31T00:00:00Z'),
  };
  const values = async config => {
    const { records } = await extract(AppleHealthHeartExtractor, { input, ...config });
    return records.map(record => Object.values(record.data.values)[0]);
  };
  assert.deepEqual(await values(window), [72, 72, 74, 31, 'Sinus Rhythm']);
  assert.deepEqual(await values({ ...window, limit: 2 }), [72, 72]);

  const { records } = await extract(AppleHealthSleepExtractor, {
    input,
    since: new Date('2025-01-15T12:00:00Z'),
  });
  assert.deepEqual(
    records.map(record => record.data.start),
    ['2025-01-15T18:00:00.000Z']
  );
});

/** Zip the export folder as the Health app does, as `export.zip` holding `apple_health_export/`. */
function zipExport(folder, zip) {
  const files = {};
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files[`apple_health_export/${relative(folder, path)}`] = readFileSync(path);
  }
  writeZip(zip, files);
  return zip;
}

test('the export reads the same zipped as unzipped, however it is passed', async t => {
  const folder = fixture(t);
  const zip = zipExport(folder, join(dirname(folder), 'export.zip'));
  const downloads = join(dirname(folder), 'downloads');
  mkdirSync(downloads);
  zipExport(folder, join(downloads, 'export.zip'));

  // Every heart reading, ECG included, is the same from the zip as from the folder.
  const unzipped = (await extract(AppleHealthHeartExtractor, { input: folder })).records;
  const zipped = (await extract(AppleHealthHeartExtractor, { input: zip })).records;
  assert.deepEqual(
    zipped.map(record => record.data),
    unzipped.map(record => record.data)
  );
  assert.equal(unzipped.at(-1).data.type, 'Electrocardiogram');

  for (const input of [folder, dirname(folder), join(folder, 'export.xml'), zip, downloads]) {
    const { records } = await extract(AppleHealthVitalsExtractor, { input, limit: 1 });
    assert.equal(records.length, 1, input);
  }

  const broken = join(dirname(folder), 'broken.zip');
  writeFileSync(broken, 'not a zip');
  for (const input of [
    broken,
    join(dirname(folder), 'missing'),
    join(folder, 'electrocardiograms'),
  ]) {
    await assert.rejects(extract(AppleHealthVitalsExtractor, { input }), error => {
      assert.equal(error.code, 'input-not-found', input);
      // A missing path names the path. Anything else also says what to pass.
      if (!input.endsWith('missing')) assert.match(error.hint ?? '', /--input/, input);
      return true;
    });
  }
});
