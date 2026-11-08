import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { findExports, writeZip } from '@chronicle.app/etl';
import {
  FitbitActivityExtractor,
  FitbitBodyMeasurementsExtractor,
  FitbitExercisesExtractor,
  FitbitHeartExtractor,
  FitbitSleepExtractor,
  FitbitTransformer,
} from '../dist/index.js';
import { PROFILE, fitbitArchiveFiles, writeFitbitArchive } from './fixture.test-helper.js';

const KINDS = [
  FitbitExercisesExtractor,
  FitbitSleepExtractor,
  FitbitHeartExtractor,
  FitbitActivityExtractor,
  FitbitBodyMeasurementsExtractor,
];

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fitbit-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return writeFitbitArchive(dir);
}

async function extract(Extractor, config) {
  const extractor = new Extractor({ limit: 0, ...config });
  await extractor.setup();
  try {
    return await Array.fromAsync(extractor.extract());
  } finally {
    await extractor.teardown();
  }
}

const transformer = new FitbitTransformer();

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

const span = action => [action.startTime, action.endTime];

test('exercises are sessions keyed by their log ID, newest first, with their tracker or app', async t => {
  const input = fixture(t);
  const records = await extract(FitbitExercisesExtractor, { input });
  const actions = await transformAll(records);
  assertKeyed(actions);

  assert.deepEqual(
    actions.map(action => [action['@type'], action.result.sourceId, action.result.category[0]]),
    [
      ['ExerciseAction', '1002', 'Walk'],
      ['ExerciseAction', '1001', 'Outdoor Bike'],
      ['ExerciseAction', '1003', 'Run'],
    ]
  );
  const [walk, ride, run] = actions;
  // Exercise times are UTC, and it ends after its duration.
  assert.deepEqual(span(ride), ['2019-07-01T15:33:19.000Z', '2019-07-01T16:03:19.000Z']);
  // It was written when Fitbit last changed the log.
  assert.equal(ride['@assertedAt'], '2019-07-01T16:10:00.000Z');
  assert.equal(ride.result.distance, 12_400);
  assert.equal(run.result.distance, 4988.97);
  assert.equal(walk.result.distance, undefined);
  assert.deepEqual(
    actions.map(action =>
      action.instrument?.map(node => [node['@type'], node.sourceId, node.name])
    ),
    [undefined, [['Device', '111', 'Charge 3']], [['SoftwareApplication', '22997K', 'Strava']]]
  );
  assert.deepEqual(
    records.map(record => record.label?.title),
    ['Walk', 'Outdoor Bike', 'Run']
  );
});

test('you are your Fitbit account, the same person as your email and @me', async t => {
  const input = fixture(t);
  const [action] = await transformAll(await extract(FitbitExercisesExtractor, { input, limit: 1 }));
  assert.deepEqual(action.agent, {
    '@type': 'Person',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'fitbit',
    sourceId: PROFILE.id,
    name: PROFILE.name,
    sameAs: [
      {
        '@type': 'Person',
        '@key': ['@type', 'source', 'handle'],
        source: 'email',
        handle: PROFILE.email,
        name: PROFILE.name,
      },
      '@me',
    ],
  });
});

test('each night is read once, its stages split by brief wakes, in the offset of the day it started', async t => {
  const input = fixture(t);
  const records = await extract(FitbitSleepExtractor, { input });
  const actions = await transformAll(records);
  assertKeyed(actions);

  const nights = actions.filter(action => action['@type'] === 'SleepAction');
  assert.deepEqual(
    nights.map(night => [night.result.sourceId, ...span(night)]),
    [
      // Away, seven hours behind UTC, as that day's heart rate file says.
      ['2003', '2019-07-11T06:00:00.000Z', '2019-07-11T13:00:00.000Z'],
      // In two of the archive's files, read once. Toronto is four hours behind.
      ['2001', '2019-07-02T03:30:00.000Z', '2019-07-02T11:00:00.000Z'],
      ['2002', '2019-06-20T17:00:00.000Z', '2019-06-20T18:00:30.000Z'],
      // The clocks went forward at 2:00, but Fitbit wrote the night in the
      // offset it started in, so it lasted eight hours.
      ['2004', '2019-03-10T04:00:00.000Z', '2019-03-10T12:00:00.000Z'],
    ]
  );

  const stagesOf = id =>
    actions
      .filter(action => action.result['@type'] === 'SleepStage')
      .filter(action => action.result.isStageOf.sourceId === id)
      .map(action => [
        action.result.category[0],
        action.startTime.slice(11, 19),
        action.endTime.slice(11, 19),
      ]);
  assert.deepEqual(stagesOf('2001'), [
    ['awake', '03:30:00', '03:35:00'],
    ['light', '03:35:00', '04:00:00'],
    ['awake', '04:00:00', '04:01:00'],
    ['light', '04:01:00', '04:34:30'],
    // A brief wake across light and deep sleep cuts both.
    ['awake', '04:34:30', '04:35:30'],
    ['deep', '04:35:30', '05:05:00'],
    ['REM', '05:05:00', '11:00:00'],
  ]);
  // A classic night's restless and awake minutes are one waking.
  assert.deepEqual(stagesOf('2002'), [
    ['asleep', '17:00:00', '17:30:00'],
    ['awake', '17:30:00', '17:33:00'],
    ['asleep', '17:33:00', '18:00:00'],
  ]);
  // A stretch the tracker couldn't read isn't a stage.
  assert.deepEqual(stagesOf('2003'), [
    ['light', '06:00:00', '07:00:00'],
    ['deep', '07:10:00', '13:00:00'],
  ]);
  assert.deepEqual(
    records.map(record => record.label?.title),
    ['Night’s sleep', 'Night’s sleep', 'Nap', 'Night’s sleep']
  );
});

test('heart rate is every reading in UTC, and each resting heart rate is over its local day', async t => {
  const input = fixture(t);
  const actions = await transformAll(await extract(FitbitHeartExtractor, { input }));
  assertKeyed(actions);
  assert.deepEqual(
    actions.map(action => [
      action.timestamp ?? `${action.startTime} – ${action.endTime}`,
      action.object.heartRate ?? `resting ${action.object.restingHeartRate}`,
    ]),
    [
      ['2019-07-12T06:59:58.000Z', 61],
      ['2019-07-11T07:00:03.000Z', 60],
      ['2019-07-11T06:59:55.000Z', 61],
      ['2019-07-10T07:00:05.000Z', 60],
      // The day away began at 7:00 UTC. The days with a zero aren't read.
      ['2019-07-10T07:00:00.000Z – 2019-07-11T07:00:00.000Z', 'resting 61.5'],
      ['2019-07-03T03:59:50.000Z', 62],
      ['2019-07-02T12:05:00.000Z', 61],
      ['2019-07-02T04:00:10.000Z', 60],
      ['2019-07-02T03:59:55.000Z', 62],
      ['2019-07-01T15:40:00.000Z', 61],
      ['2019-07-01T04:00:05.000Z', 60],
      ['2019-07-01T04:00:00.000Z – 2019-07-02T04:00:00.000Z', 'resting 58.25'],
    ]
  );
  assert.deepEqual(actions[0]['@key'], ['@type', 'source', 'timestamp', 'object.heartRate']);
  assert.equal(actions[0].instrument, undefined);
});

test('steps are each minute with steps, in UTC', async t => {
  const input = fixture(t);
  const actions = await transformAll(await extract(FitbitActivityExtractor, { input }));
  assertKeyed(actions);
  assert.deepEqual(
    actions.map(action => [...span(action), action.object.stepCount]),
    [
      ['2019-07-02T12:00:00.000Z', '2019-07-02T12:01:00.000Z', 80],
      ['2019-07-01T15:36:00.000Z', '2019-07-01T15:37:00.000Z', 104],
      ['2019-07-01T15:34:00.000Z', '2019-07-01T15:35:00.000Z', 96],
    ]
  );
});

test('weights are in kilograms, each logged once, at their local time', async t => {
  const input = fixture(t);
  const actions = await transformAll(await extract(FitbitBodyMeasurementsExtractor, { input }));
  assertKeyed(actions);
  assert.deepEqual(
    actions.map(action => [
      action.sourceId,
      action.timestamp,
      action.object.weight,
      action.instrument?.[0].handle,
    ]),
    [
      // Logged at midnight on the day away.
      ['1562803200000', '2019-07-11T07:00:00.000Z', 75.296, undefined],
      ['1561975200000', '2019-07-01T14:00:00.000Z', 74.843, 'Aria'],
    ]
  );
});

test('a weight already in kilograms stays in kilograms', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitbit-kg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = writeFitbitArchive(dir);
  writeFileSync(
    join(input, 'SamExample/Personal & Account/weight-2019-06-12.json'),
    JSON.stringify([{ logId: 1, weight: 74.8, bmi: 23.1, date: '07/01/19', time: '10:00:00' }])
  );
  const [action] = await transformAll(await extract(FitbitBodyMeasurementsExtractor, { input }));
  assert.equal(action.object.weight, 74.8);
});

test('since, until, and limit bound each kind', async t => {
  const input = fixture(t);
  const since = new Date('2019-07-02T00:00:00Z');
  const until = new Date('2019-07-10T23:59:59Z');
  const bounded = async (Extractor, config = {}) =>
    (await extract(Extractor, { input, since, until, ...config })).map(
      record => record.data.startTime ?? record.data.timestamp
    );
  assert.deepEqual(await bounded(FitbitExercisesExtractor), ['2019-07-02T12:00:00.000Z']);
  assert.deepEqual(await bounded(FitbitSleepExtractor), ['2019-07-02T03:30:00.000Z']);
  assert.deepEqual(await bounded(FitbitHeartExtractor), [
    '2019-07-10T07:00:05.000Z',
    '2019-07-10T07:00:00.000Z',
    '2019-07-03T03:59:50.000Z',
    '2019-07-02T12:05:00.000Z',
    '2019-07-02T04:00:10.000Z',
    '2019-07-02T03:59:55.000Z',
  ]);
  assert.deepEqual(await bounded(FitbitHeartExtractor, { limit: 2 }), [
    '2019-07-10T07:00:05.000Z',
    '2019-07-10T07:00:00.000Z',
  ]);
  assert.deepEqual(await bounded(FitbitActivityExtractor), ['2019-07-02T12:00:00.000Z']);
  assert.deepEqual(await bounded(FitbitBodyMeasurementsExtractor), []);
});

test('kinds merge newest first by when each happened', async t => {
  const input = fixture(t);
  const sleep = new FitbitSleepExtractor({ input, limit: 0 });
  await sleep.setup();
  try {
    const [record] = await Array.fromAsync(sleep.extract());
    assert.equal(sleep.occurredAt(record).toISOString(), '2019-07-11T06:00:00.000Z');
  } finally {
    await sleep.teardown();
  }
});

test('the archive reads the same zipped, and from the folder named for you', async t => {
  const input = fixture(t);
  const zip = join(dirname(input), 'MyFitbitData.zip');
  writeZip(zip, fitbitArchiveFiles());
  for (const Extractor of KINDS) {
    const fromFolder = (await extract(Extractor, { input })).map(record => record.data);
    assert.ok(fromFolder.length > 0, Extractor.name);
    for (const other of [zip, join(input, 'SamExample')]) {
      const records = await extract(Extractor, { input: other });
      assert.deepEqual(
        records.map(record => record.data),
        fromFolder,
        `${Extractor.name} from ${other}`
      );
    }
  }
});

test('its layout finds the archive where it starts, unzipped and zipped', async t => {
  const input = fixture(t);
  const downloads = join(dirname(input), 'downloads');
  mkdirSync(downloads);
  writeZip(join(downloads, 'MyFitbitData.zip'), fitbitArchiveFiles());
  const { chronicle } = JSON.parse(
    await import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
    )
  );
  const sets = Object.entries(chronicle.sources).flatMap(([source, { strategies }]) =>
    Object.entries(strategies).map(([strategy, { layouts = [] }]) => ({
      source,
      strategy,
      layouts,
    }))
  );
  const { exports } = await findExports(dirname(input), sets);
  assert.deepEqual(
    exports.map(found => found.root),
    [
      join(downloads, 'MyFitbitData.zip', 'MyFitbitData/SamExample'),
      join(input, 'SamExample'),
    ].sort()
  );
});

test('a folder without a Fitbit archive is an input that isn’t found', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'fitbit-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'notes.txt'), 'nothing here');
  await assert.rejects(extract(FitbitSleepExtractor, { input: dir }), {
    code: 'input-not-found',
  });
});
