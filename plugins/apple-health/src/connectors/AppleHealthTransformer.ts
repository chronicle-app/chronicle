import { ChronicleTransformer, Record, reference, selfAgent } from '@chronicle.app/etl';
import { buildICloudPersonSchema } from '@chronicle.app/apple';
import {
  ActionAndChildren,
  Device,
  EntityAndChildren,
  ExperienceAction,
  MeasureAction,
  Person,
  SleepAction,
  SleepSession,
  SleepStage,
} from '@chronicle.app/schema';
import { type HealthDevice, isAppleModel } from '../device.js';
import type { Reading } from '../readings.js';
import type { SleepPeriod } from '../sleep.js';

const SOURCE = 'apple-health';

/** What a source is, as the extractor found it. */
interface Measurer {
  sourceName?: string;
  app: boolean;
  device: HealthDevice | null;
}

/**
 * The export gives nothing an ID, so each record is keyed by what it says:
 * when, by what, and what was measured or slept.
 *
 *   heart, respiratory, body-measurements, activity:
 *          MeasureAction  agent: you   object: you { heartRate, … }
 *                    timestamp, or startTime and endTime for a value over a period,
 *                    such as the steps taken in it
 *                    instrument: Device (the name it goes by in Health)
 *                                or SoftwareApplication (an app)
 *                                or ProductModel (an ECG's watch model)
 *   sleep: SleepAction  agent: you   startTime, endTime
 *            result: SleepSession
 *          ExperienceAction for each stage   startTime, endTime
 *            result: SleepStage  category: the stage
 *                    isStageOf: the SleepSession  resultOf: the SleepAction
 */
export default class AppleHealthTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    // Without an iCloud account, you are Health's own record of you.
    const you =
      (await buildICloudPersonSchema(record.context.account)) ?? selfAgent({ source: SOURCE });
    switch (record.extraction.recordType) {
      case 'heart':
      case 'respiratory':
      case 'body-measurements':
      case 'activity':
        return [measure(record.data as Reading, you)];
      case 'sleep':
        return sleep(record.data as SleepPeriod & Measurer, you);
      default:
        return [];
    }
  }
}

function measure(reading: Reading, you: Person): MeasureAction {
  const instrument = instrumentOf(reading);
  const when =
    reading.start === reading.end
      ? { timestamp: reading.start }
      : { startTime: reading.start, endTime: reading.end };
  return {
    '@type': 'MeasureAction',
    // An ECG names no source, only the watch's model.
    '@key': [
      '@type',
      'source',
      ...Object.keys(when),
      ...(reading.sourceName ? ['instrument[*].handle'] : []),
      ...Object.keys(reading.values).map(property => `object.${property}`),
    ],
    source: SOURCE,
    ...when,
    agent: you,
    object: { ...you, ...reading.values } as Person,
    ...(instrument.length > 0 && { instrument }),
  };
}

/** A session has no times of its own, so it's keyed by the action it's the result of. */
const SESSION_KEY = ['resultOf.startTime', 'resultOf.endTime', 'resultOf.instrument[*].handle'];

function sleep(period: SleepPeriod & Measurer, you: Person): ActionAndChildren[] {
  const instrument = instrumentOf(period);
  const night: SleepSession = {
    '@type': 'SleepSession',
    '@key': ['@type', 'source', ...SESSION_KEY],
    source: SOURCE,
  };
  const slept: SleepAction = {
    '@type': 'SleepAction',
    '@key': ['@type', 'source', 'startTime', 'endTime', 'instrument[*].handle'],
    source: SOURCE,
    startTime: period.start,
    endTime: period.end,
    agent: you,
    ...(instrument.length > 0 && { instrument }),
    result: night,
  };
  const actions: ActionAndChildren[] = [slept];
  // Each stage is a stage of the night. Under a stage the night isn't its
  // action's result, so it says which action it's the result of.
  const stageOf: SleepSession = { ...night, resultOf: [reference(slept)] };
  for (const { stage, start, end } of period.stages) {
    actions.push({
      '@type': 'ExperienceAction',
      '@key': [
        '@type',
        'source',
        'startTime',
        'endTime',
        'instrument[*].handle',
        'result.category',
      ],
      source: SOURCE,
      startTime: start,
      endTime: end,
      agent: you,
      ...(instrument.length > 0 && { instrument }),
      result: {
        '@type': 'SleepStage',
        '@key': ['@type', 'source', 'category', ...SESSION_KEY],
        source: SOURCE,
        category: [stage],
        isStageOf: stageOf,
      } satisfies SleepStage,
    } satisfies ExperienceAction);
  }
  return actions;
}

/**
 * What took a reading: the device by the name it goes by in Health, with its
 * hardware as its model, or an app by its name. An ECG names only the watch's
 * model, by Apple's identifier for it.
 */
function instrumentOf({ sourceName, app, device }: Measurer): EntityAndChildren[] {
  if (app && sourceName) {
    return [
      {
        '@type': 'SoftwareApplication',
        '@key': ['@type', 'source', 'handle'],
        source: SOURCE,
        handle: sourceName,
        name: sourceName,
      },
    ];
  }
  if (sourceName) {
    return [
      {
        '@type': 'Device',
        '@key': ['@type', 'source', 'handle'],
        source: SOURCE,
        handle: sourceName,
        name: sourceName,
        ...(device?.hardware && { model: device.hardware }),
      } satisfies Device,
    ];
  }
  if (isAppleModel(device?.hardware)) {
    return [
      {
        '@type': 'ProductModel',
        '@key': ['source', 'sourceId'],
        source: 'apple-model-id',
        sourceId: device.hardware,
      },
    ];
  }
  return [];
}
