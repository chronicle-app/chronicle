import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { writeZip } from '@chronicle.app/etl';
import { METRIC_PROPERTIES } from '@chronicle.app/schema';
import {
  AppleHealthActivityExtractor,
  AppleHealthBodyMeasurementsExtractor,
  AppleHealthHeartExtractor,
  AppleHealthRespiratoryExtractor,
  AppleHealthSleepExtractor,
  AppleHealthTransformer,
} from '../dist/index.js';
import { ACTIVITY, READING_TYPES } from '../dist/readings.js';
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

// A node's key as a store reads it: each key field, a path, with its values. A
// path can step through lists (`[*]`) and back along an edge: a node under an
// action's `result` is `resultOf` that action.
function keyOf(node, parent) {
  const from = parent?.result === node ? { resultOf: [parent], ...node } : node;
  return node['@key'].map(field => {
    let values = [from];
    for (const name of field.replace('[*]', '').split('.')) {
      values = values.flatMap(value => value?.[name] ?? []);
    }
    return [field, values];
  });
}

// Every node in an action, with the node it's under.
function* nodesOf(node, parent) {
  yield [node, parent];
  for (const value of Object.values(node).flat()) {
    if (value && typeof value === 'object' && value['@type']) yield* nodesOf(value, node);
  }
}

// Every key field of every node names something the node has.
function assertKeyed(actions) {
  for (const action of actions) {
    for (const [node, parent] of nodesOf(action)) {
      for (const [field, values] of keyOf(node, parent)) {
        assert.ok(values.length > 0, `${node['@type']} has no ${field}`);
      }
    }
  }
}

// An instrument as [type, key, model]: a device by its name, with its model,
// an app by its name, or a model by Apple's identifier.
const instruments = action =>
  (action.instrument ?? []).map(node => [
    node['@type'],
    node.handle ?? node.sourceId,
    ...(node.model ? [node.model] : []),
  ]);

test('heart readings become MeasureActions on you, keyed by what they say', async t => {
  const { records } = await extract(AppleHealthHeartExtractor, { input: fixture(t) });
  const actions = await transformAll(records);

  assert.deepEqual(
    actions.map(action => [
      action.timestamp ?? `${action.startTime}/${action.endTime}`,
      action.object,
    ]),
    // Newest first. Readings that start together keep the export's order.
    [
      // A winter reading carries the export's offset, and the instant is still right.
      ['2025-02-01T13:00:00.000Z/2025-02-01T13:05:00.000Z', { heartRate: 64.5 }],
      // The inconclusive ECG says nothing about the rhythm, so only one is here.
      ['2025-01-20T17:04:55.000Z', { heartRhythm: 'Sinus Rhythm' }],
      ['2025-01-15T22:35:00.000Z', { heartRateRecovery: 31 }],
      ['2025-01-15T15:58:00.000Z', { systolicBloodPressure: 118, diastolicBloodPressure: 76 }],
      ['2025-01-15T12:00:00.000Z', { heartRate: 72 }],
      ['2025-01-15T12:00:00.000Z', { heartRate: 72 }],
      ['2025-01-15T12:00:00.000Z', { heartRate: 74 }],
      ['2025-01-15T07:00:00.000Z/2025-01-15T07:01:00.000Z', { heartRateVariability: 48.25 }],
      ['2025-01-15T04:00:00.000Z/2025-01-16T03:59:00.000Z', { restingHeartRate: 58 }],
      ['2025-01-15T04:00:00.000Z/2025-01-16T03:59:00.000Z', { walkingHeartRate: 97 }],
      ['2024-12-01T11:00:00.000Z', { heartRate: 61 }],
      ['2024-06-01T14:00:00.000Z', { heartRate: 80 }],
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
    assert.equal(action.sourceId, undefined);
  }
  assertKeyed(actions);

  // A reading is asserted when Health wrote it, which can be well after it was
  // taken: a day's resting heart rate is written the next morning. An ECG gives
  // no such time, so it's asserted when it was recorded.
  assert.deepEqual(
    actions.map(action => action['@assertedAt']),
    [
      '2025-02-01T13:10:00.000Z',
      '2025-01-20T17:04:55.000Z',
      '2025-01-15T22:40:00.000Z',
      '2025-01-15T16:00:00.000Z',
      '2025-01-15T12:01:00.000Z',
      '2025-01-15T12:01:00.000Z',
      '2025-01-15T12:01:00.000Z',
      '2025-01-15T07:01:00.000Z',
      '2025-01-16T11:00:00.000Z',
      '2025-01-16T11:00:00.000Z',
      '2024-12-01T11:00:00.000Z',
      '2024-06-01T14:00:00.000Z',
    ]
  );

  // A reading is keyed by when it was taken, by what, and what it measured. An
  // exact duplicate has the same key. A different value at the same instant doesn't.
  const [ecg, first, duplicate, other] = [1, 4, 5, 6].map(index => actions[index]);
  assert.deepEqual(keyOf(first), [
    ['@type', ['MeasureAction']],
    ['source', ['apple-health']],
    ['timestamp', ['2025-01-15T12:00:00.000Z']],
    ['instrument[*].handle', [WATCH]],
    ['object.heartRate', [72]],
  ]);
  assert.deepEqual(keyOf(first), keyOf(duplicate));
  assert.notDeepEqual(keyOf(first), keyOf(other));
  assert.deepEqual(keyOf(actions[8]).slice(2), [
    ['startTime', ['2025-01-15T04:00:00.000Z']],
    ['endTime', ['2025-01-16T03:59:00.000Z']],
    ['instrument[*].handle', [WATCH]],
    ['object.restingHeartRate', [58]],
  ]);
  assert.notDeepEqual(keyOf(actions[8]), keyOf(actions[9]));
  // An ECG names no source.
  assert.deepEqual(keyOf(ecg).slice(2), [
    ['timestamp', ['2025-01-20T17:04:55.000Z']],
    ['object.heartRhythm', ['Sinus Rhythm']],
  ]);

  // The same watch under two addresses, on two releases, is one device, with
  // its hardware as its model. A sample that doesn't describe its device takes
  // the model from the rest of the export.
  const watch = [['Device', WATCH, 'Watch7,1']];
  assert.deepEqual(instruments(first), watch);
  assert.deepEqual(instruments(other), watch);
  assert.deepEqual(instruments(actions[0]), watch);
  assert.deepEqual(instruments(actions[8]), watch);
  assert.deepEqual(first.instrument[0], {
    '@type': 'Device',
    '@key': ['@type', 'source', 'handle'],
    source: 'apple-health',
    handle: WATCH,
    name: WATCH,
    model: 'Watch7,1',
  });
  // An app is named by its name. The watch's earlier name is another device.
  assert.deepEqual(instruments(actions[11]), [['SoftwareApplication', 'Pulse Pal']]);
  assert.deepEqual(instruments(actions[10]), [['Device', OLD_WATCH, 'Watch7,1']]);
  // An ECG names the watch's model but not the watch.
  assert.deepEqual(ecg.instrument, [
    {
      '@type': 'ProductModel',
      '@key': ['source', 'sourceId'],
      source: 'apple-model-id',
      sourceId: 'Watch7,1',
    },
  ]);
});

test('readings convert to their units, and a blood pressure is one reading with both values', async t => {
  const input = fixture(t);
  const valuesFrom = async (Extractor, config = {}) => {
    const { records, events } = await extract(Extractor, { input, ...config });
    const actions = await transformAll(records);
    assertKeyed(actions);
    return { actions, events, values: actions.map(({ object }) => valuesOf(object)) };
  };
  const respiratory = await valuesFrom(AppleHealthRespiratoryExtractor);
  assert.deepEqual(respiratory.values, [{ oxygenSaturation: 0.97 }, { respiratoryRate: 15.5 }]);
  const body = await valuesFrom(AppleHealthBodyMeasurementsExtractor);
  // 96.8 °F
  assert.deepEqual(body.values, [{ sleepingWristTemperature: 36 }]);

  const heart = await valuesFrom(AppleHealthHeartExtractor, { series: 'BloodPressure' });
  assert.deepEqual(heart.values, [{ systolicBloodPressure: 118, diastolicBloodPressure: 76 }]);
  const pressure = heart.actions[0];
  assert.equal(pressure.timestamp, '2025-01-15T15:58:00.000Z');
  assert.deepEqual(keyOf(pressure).slice(2), [
    ['timestamp', ['2025-01-15T15:58:00.000Z']],
    ['instrument[*].handle', ['Health']],
    ['object.systolicBloodPressure', [118]],
    ['object.diastolicBloodPressure', [76]],
  ]);
  assert.deepEqual(instruments(pressure), [['SoftwareApplication', 'Health']]);

  // A sample in a unit there's no conversion for is left out, and the run says so.
  const hints = body.events.filter(event => event.kind === 'hint');
  assert.equal(hints.length, 1);
  assert.match(hints[0].message, /^1 sample was left out/);
});

test('steps and active energy are amounts over their periods, one reading per device', async t => {
  const { records } = await extract(AppleHealthActivityExtractor, { input: fixture(t) });
  const actions = await transformAll(records);
  assertKeyed(actions);

  // Newest first. The app's energy arrives in kilojoules and becomes kilocalories.
  assert.deepEqual(
    actions.map(action => [
      `${action.startTime}/${action.endTime}`,
      instruments(action)[0][1],
      valuesOf(action.object),
    ]),
    [
      [
        '2025-01-15T22:15:00.000Z/2025-01-15T22:35:00.000Z',
        'Pulse Pal',
        { activeEnergyBurned: 100 },
      ],
      ['2025-01-15T12:52:00.000Z/2025-01-15T12:53:00.000Z', WATCH, { stepCount: 96 }],
      ['2025-01-15T12:52:00.000Z/2025-01-15T12:53:00.000Z', WATCH, { activeEnergyBurned: 4.125 }],
      ['2025-01-15T12:50:00.000Z/2025-01-15T12:59:00.000Z', PHONE, { stepCount: 512 }],
    ]
  );
  assert.ok(actions.every(action => action.timestamp === undefined));

  // The watch counted some of the steps the phone did, over the same minute.
  // Each device's count is its own reading, so adding them up counts those
  // steps twice. Picking a device for each stretch of time is left to whatever
  // reads them.
  assert.deepEqual(keyOf(actions[1]).slice(2), [
    ['startTime', ['2025-01-15T12:52:00.000Z']],
    ['endTime', ['2025-01-15T12:53:00.000Z']],
    ['instrument[*].handle', [WATCH]],
    ['object.stepCount', [96]],
  ]);
  assert.deepEqual(instruments(actions[1]), [['Device', WATCH, 'Watch7,1']]);
  assert.deepEqual(instruments(actions[3]), [['Device', PHONE, 'iPhone15,2']]);
  assert.deepEqual(instruments(actions[0]), [['SoftwareApplication', 'Pulse Pal']]);
});

test('every value Health measures is a metric in the vocabulary, with a unit', () => {
  // Activity's values are amounts, so sums. The rest are levels or rates, so gauges.
  for (const [type, { property }] of Object.entries(READING_TYPES)) {
    assert.equal(METRIC_PROPERTIES[property]?.metric, type in ACTIVITY ? 'sum' : 'gauge', property);
  }
});

test('sleep is grouped into periods per source, each with its stages', async t => {
  const { records } = await extract(AppleHealthSleepExtractor, { input: fixture(t) });
  const actions = await transformAll(records);
  const nights = actions.filter(action => action['@type'] === 'SleepAction');

  // Newest first. The phone and the watch each have their own night, and the
  // nap is its own period.
  assert.deepEqual(
    nights.map(night => [night.instrument[0].handle, night.startTime, night.endTime]),
    [
      [WATCH, '2025-01-15T18:00:00.000Z', '2025-01-15T18:30:00.000Z'],
      [WATCH, '2025-01-15T03:05:00.000Z', '2025-01-15T10:50:00.000Z'],
      [PHONE, '2025-01-15T02:45:00.000Z', '2025-01-15T11:00:00.000Z'],
      ['Sleep Cycle', '2016-03-02T03:30:00.000Z', '2016-03-02T10:45:00.000Z'],
    ]
  );
  assert.deepEqual(instruments(nights[3]), [['SoftwareApplication', 'Sleep Cycle']]);
  assert.deepEqual(instruments(nights[2]), [['Device', PHONE, 'iPhone15,2']]);
  assertKeyed(actions);
  assert.ok(actions.every(action => action.sourceId === undefined));
  // A night is asserted when Health wrote the last of its samples.
  assert.deepEqual(
    nights.map(night => night['@assertedAt']),
    [
      '2025-01-15T18:30:00.000Z',
      '2025-01-15T10:50:00.000Z',
      '2025-01-15T11:00:00.000Z',
      '2016-03-02T11:00:00.000Z',
    ]
  );

  // A night is keyed by its source and its times, and its session by the
  // night it's the result of.
  const night = nights[1];
  assert.equal(night.result['@type'], 'SleepSession');
  assert.deepEqual(keyOf(night).slice(2), [
    ['startTime', ['2025-01-15T03:05:00.000Z']],
    ['endTime', ['2025-01-15T10:50:00.000Z']],
    ['instrument[*].handle', [WATCH]],
  ]);
  assert.deepEqual(keyOf(night.result, night).slice(2), [
    ['resultOf.startTime', ['2025-01-15T03:05:00.000Z']],
    ['resultOf.endTime', ['2025-01-15T10:50:00.000Z']],
    ['resultOf.instrument[*].handle', [WATCH]],
  ]);

  // The night's stages, each a Session that is part of the night. There the
  // night says what it's the result of, so its key is the same. `in bed` and a
  // stage over the same span are two stages.
  const sameNight = node =>
    JSON.stringify(keyOf(node)) === JSON.stringify(keyOf(night.result, night));
  const stages = actions
    .filter(action => action['@type'] === 'ExperienceAction')
    .filter(action => sameNight(action.result.isPartOf[0]));
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
  }
  // A stage is keyed by its source, its times, and the stage, and so is its session.
  const deep = stages.find(stage => stage.result.category[0] === 'deep');
  assert.deepEqual(keyOf(deep).slice(2), [
    ['startTime', ['2025-01-15T04:10:00.000Z']],
    ['endTime', ['2025-01-15T04:40:00.000Z']],
    ['instrument[*].handle', [WATCH]],
    ['result.category', ['deep']],
  ]);
  assert.deepEqual(keyOf(deep.result, deep).slice(2), [
    ['category', ['deep']],
    ['resultOf.startTime', ['2025-01-15T04:10:00.000Z']],
    ['resultOf.endTime', ['2025-01-15T04:40:00.000Z']],
    ['resultOf.instrument[*].handle', [WATCH]],
  ]);
  const stageKeys = stages.map(stage => JSON.stringify(keyOf(stage)));
  assert.equal(new Set(stageKeys).size, stages.length);
});

test('since, until, and limit pick the newest readings by when they started', async t => {
  const input = fixture(t);
  const window = {
    since: new Date('2025-01-15T12:00:00Z'),
    until: new Date('2025-01-31T00:00:00Z'),
  };
  const values = async config => {
    const { records } = await extract(AppleHealthHeartExtractor, { input, ...config });
    return records.map(record => Object.values(record.data.values)[0]);
  };
  assert.deepEqual(await values(window), ['Sinus Rhythm', 31, 118, 72, 72, 74]);
  assert.deepEqual(await values({ ...window, limit: 2 }), ['Sinus Rhythm', 31]);

  const { records } = await extract(AppleHealthSleepExtractor, {
    input,
    since: new Date('2025-01-15T12:00:00Z'),
  });
  assert.deepEqual(
    records.map(record => record.data.start),
    ['2025-01-15T18:00:00.000Z']
  );
});

test('a series narrows a kind to it, and a kind with none of the series reads nothing', async t => {
  const input = fixture(t);
  const read = async (Extractor, series) => {
    const { records } = await extract(Extractor, { input, series });
    return records.map(record => Object.keys(record.data.values ?? { sleep: true }));
  };
  assert.deepEqual(await read(AppleHealthHeartExtractor, 'RestingHeartRate'), [
    ['restingHeartRate'],
  ]);
  // Names match whatever their case, with or without HealthKit's prefix.
  assert.deepEqual(
    await read(
      AppleHealthHeartExtractor,
      'restingheartrate, HKQuantityTypeIdentifierHeartRateRecoveryOneMinute'
    ),
    [['heartRateRecovery'], ['restingHeartRate']]
  );
  assert.deepEqual(await read(AppleHealthHeartExtractor, 'Electrocardiogram'), [['heartRhythm']]);

  // A run of several kinds passes each the same series, and each reads its own.
  const series = 'RespiratoryRate,SleepAnalysis';
  assert.deepEqual(await read(AppleHealthHeartExtractor, series), []);
  assert.deepEqual(await read(AppleHealthRespiratoryExtractor, series), [['respiratoryRate']]);
  assert.equal((await read(AppleHealthSleepExtractor, series)).length, 4);

  // A kind with none of the series doesn't read the export, even a broken one.
  const broken = join(dirname(input), 'broken');
  mkdirSync(broken);
  writeFileSync(join(broken, 'export.xml'), '<HealthData><Record type=');
  await assert.rejects(extract(AppleHealthRespiratoryExtractor, { input: broken }));
  const skipped = await extract(AppleHealthRespiratoryExtractor, {
    input: broken,
    series: 'SleepAnalysis',
  });
  assert.deepEqual(skipped.records, []);

  await assert.rejects(
    extract(AppleHealthHeartExtractor, { input, series: 'RestingHeartRate,Steps' }),
    error => {
      assert.equal(error.code, 'unknown-series');
      assert.match(error.message, /no series "Steps"/);
      assert.match(
        error.hint,
        /heart: HeartRate, .*; respiratory: RespiratoryRate, OxygenSaturation;/
      );
      return true;
    }
  );

  // Without a kind, a run reads the kinds its series are in.
  assert.deepEqual(AppleHealthHeartExtractor.kindsFor({ series }), ['respiratory', 'sleep']);
  assert.deepEqual(AppleHealthHeartExtractor.kindsFor({ series: 'StepCount' }), ['activity']);
  assert.equal(AppleHealthHeartExtractor.kindsFor({}), undefined);
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
  assert.ok(unzipped.some(record => record.data.type === 'Electrocardiogram'));

  for (const input of [folder, dirname(folder), join(folder, 'export.xml'), zip, downloads]) {
    const { records } = await extract(AppleHealthRespiratoryExtractor, { input, limit: 1 });
    assert.equal(records.length, 1, input);
  }

  const broken = join(dirname(folder), 'broken.zip');
  writeFileSync(broken, 'not a zip');
  for (const input of [
    broken,
    join(dirname(folder), 'missing'),
    join(folder, 'electrocardiograms'),
  ]) {
    await assert.rejects(extract(AppleHealthRespiratoryExtractor, { input }), error => {
      assert.equal(error.code, 'input-not-found', input);
      // A missing path names the path. Anything else also says what to pass.
      if (!input.endsWith('missing')) assert.match(error.hint ?? '', /--input/, input);
      return true;
    });
  }
});
