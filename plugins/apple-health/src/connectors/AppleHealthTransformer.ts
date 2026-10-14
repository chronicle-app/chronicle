import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import {
  ActionAndChildren,
  Device,
  EntityAndChildren,
  ExperienceAction,
  MeasureAction,
  Person,
  SleepAction,
  SleepSession,
} from '@chronicle.app/schema';
import { type HealthDevice, lineOfHardware, productLine } from '../device.js';
import { type Reading, readingKey } from '../readings.js';
import type { SleepPeriod } from '../sleep.js';

const SOURCE = 'apple-health';

/** What a source is, as the extractor found it. */
interface Measurer {
  sourceName?: string;
  app: boolean;
  device: HealthDevice | null;
}

/**
 *   heart, vitals: MeasureAction  agent: you   object: you { heartRate, … }
 *                    timestamp, or startTime and endTime for a value over a period
 *                    instrument: Device (the name it goes by in Health)
 *                                ProductModel? (the kind of device, by its Wikidata ID)
 *                                OperatingSystem? (the release it ran)
 *                                or SoftwareApplication (an app)
 *   sleep: SleepAction  agent: you   startTime, endTime
 *            result: SleepSession
 *          ExperienceAction for each stage   startTime, endTime
 *            result: Session  category: the stage   isPartOf: the SleepSession
 */
export default class AppleHealthTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    // Without an iCloud account, you are Health's own record of you.
    const you =
      (await buildICloudPersonSchema(record.context.account)) ?? selfAgent({ source: SOURCE });
    switch (record.extraction.recordType) {
      case 'heart':
      case 'vitals':
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
  return {
    '@type': 'MeasureAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: readingKey(reading),
    ...(reading.start === reading.end
      ? { timestamp: reading.start }
      : { startTime: reading.start, endTime: reading.end }),
    agent: you,
    object: { ...you, ...reading.values } as Person,
    ...(instrument.length > 0 && { instrument }),
  };
}

function sleep(period: SleepPeriod & Measurer, you: Person): ActionAndChildren[] {
  const instrument = instrumentOf(period);
  const night: SleepSession = {
    '@type': 'SleepSession',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: [period.sourceName, period.start, period.end].join('|'),
  };
  const actions: ActionAndChildren[] = [
    {
      '@type': 'SleepAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: night.sourceId,
      startTime: period.start,
      endTime: period.end,
      agent: you,
      ...(instrument.length > 0 && { instrument }),
      result: night,
    } satisfies SleepAction,
  ];
  for (const { stage, start, end } of period.stages) {
    const sourceId = ['SleepAnalysis', period.sourceName, start, end, stage].join('|');
    actions.push({
      '@type': 'ExperienceAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId,
      startTime: start,
      endTime: end,
      agent: you,
      ...(instrument.length > 0 && { instrument }),
      result: {
        '@type': 'Session',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId,
        category: [stage],
        isPartOf: [{ ...night }],
      },
    } satisfies ExperienceAction);
  }
  return actions;
}

/**
 * What took a reading, as precisely as the export says: the device by the
 * name it goes by in Health, the kind of device, and the OS release it ran.
 * An app is named by its name alone. An ECG names only the watch's hardware,
 * so it gives only the kind of device.
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
  const line = productLine(device?.model) ?? lineOfHardware(device?.hardware);
  const instrument: EntityAndChildren[] = [];
  if (sourceName) {
    instrument.push({
      '@type': 'Device',
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle: sourceName,
      name: sourceName,
      ...(device?.hardware && { model: device.hardware }),
      ...(line && { category: [line.category] }),
    } satisfies Device);
  }
  if (line) {
    instrument.push({
      '@type': 'ProductModel',
      '@key': ['source', 'sourceId'],
      source: 'wikidata',
      sourceId: line.wikidataId,
      name: line.name,
      url: `https://www.wikidata.org/wiki/${line.wikidataId}`,
    });
    if (device?.software) {
      instrument.push({
        '@type': 'OperatingSystem',
        '@key': ['@type', 'source', 'handle'],
        source: SOURCE,
        handle: `${line.os} ${device.software}`,
      });
    }
  }
  return instrument;
}
