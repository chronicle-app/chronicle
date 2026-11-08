import { ChronicleTransformer, type Record, selfAgent } from '@chronicle.app/etl';
import type {
  ActionAndChildren,
  Device,
  EntityAndChildren,
  ExerciseAction,
  ExerciseSession,
  ExperienceAction,
  MeasureAction,
  Person,
  SleepAction,
  SleepSession,
  SleepStage,
} from '@chronicle.app/schema';
import type { Exercise, ExerciseLog } from './FitbitExercisesExtractor.js';
import type { FitbitProfile } from './FitbitArchiveExtractor.js';
import type { Measurement } from './measurement.js';
import type { Sleep } from './FitbitSleepExtractor.js';

const SOURCE = 'fitbit';

// Meters in each unit the archive gives a distance in.
const METERS: { [unit: string]: number } = {
  Kilometer: 1000,
  Mile: 1609.344,
  Meter: 1,
};

/**
 * Fitbit gives exercises, nights, and weights an ID, so those are keyed by
 * it. Heart rate and steps readings have none, and are keyed by what they
 * say: when, and the value.
 *
 *   exercises: ExerciseAction  agent: you   startTime, endTime
 *                instrument: the tracker (Device) or the app, when the log names one
 *                result: ExerciseSession  sourceId: the log's ID
 *                        category: the kind, such as Walk   distance: meters
 *   sleep:     SleepAction  agent: you   startTime, endTime
 *                result: SleepSession  sourceId: the log's ID
 *              ExperienceAction for each stage   startTime, endTime
 *                result: SleepStage  category: the stage   isStageOf: the SleepSession
 *   heart, activity, body-measurements:
 *              MeasureAction  agent: you   object: you { heartRate, … }
 *                timestamp, or startTime and endTime for a value over a period
 */
export default class FitbitTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    const you = self(record.context.profile as FitbitProfile);
    switch (record.extraction.recordType) {
      case 'exercises':
        return [exercise(record.data as Exercise, you)];
      case 'sleep':
        return sleep(record.data as Sleep, you);
      case 'heart':
      case 'activity':
      case 'body-measurements':
        return [measure(record.data as Measurement, you)];
      default:
        return [];
    }
  }
}

/** You, by your Fitbit user ID, and by your email as the mail plugins key you. */
function self(profile: FitbitProfile): Person {
  const sameAs = profile.email
    ? [
        {
          '@type': 'Person' as const,
          '@key': ['@type', 'source', 'handle'],
          source: 'email',
          handle: profile.email,
          ...(profile.name && { name: profile.name }),
        },
      ]
    : [];
  return selfAgent({ source: SOURCE, sourceId: profile.id, name: profile.name, sameAs }) as Person;
}

function exercise({ startTime, endTime, log }: Exercise, you: Person): ExerciseAction {
  const meters = log.distance === undefined ? undefined : METERS[log.distanceUnit ?? 'Kilometer'];
  const session: ExerciseSession = {
    '@type': 'ExerciseSession',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: String(log.logId),
    category: [log.activityName],
    ...(meters !== undefined && { distance: Math.round(log.distance! * meters * 100) / 100 }),
  };
  const instrument = instrumentOf(log.source);
  return {
    '@type': 'ExerciseAction',
    // Keyed by the session it made, which has the log's ID.
    '@key': ['@type', 'source', 'result.sourceId'],
    source: SOURCE,
    startTime,
    endTime,
    agent: you,
    ...(instrument && { instrument: [instrument] }),
    result: session,
  };
}

/** The tracker or app an exercise came from, by Fitbit's ID for it. */
function instrumentOf(source: ExerciseLog['source']): EntityAndChildren | undefined {
  if (!source?.id) return undefined;
  const type = source.type === 'app' ? 'SoftwareApplication' : 'Device';
  return {
    '@type': type,
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: source.id,
    name: source.name,
  } as EntityAndChildren;
}

function sleep({ startTime, endTime, stages, log }: Sleep, you: Person): ActionAndChildren[] {
  const night: SleepSession = {
    '@type': 'SleepSession',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: String(log.logId),
  };
  const slept: SleepAction = {
    '@type': 'SleepAction',
    '@key': ['@type', 'source', 'result.sourceId'],
    source: SOURCE,
    startTime,
    endTime,
    agent: you,
    result: night,
  };
  return [
    slept,
    ...stages.map(
      ({ stage, startTime, endTime }) =>
        ({
          '@type': 'ExperienceAction',
          '@key': ['@type', 'source', 'startTime', 'endTime', 'result.category'],
          source: SOURCE,
          startTime,
          endTime,
          agent: you,
          result: {
            '@type': 'SleepStage',
            '@key': ['@type', 'source', 'category', 'resultOf.startTime', 'resultOf.endTime'],
            source: SOURCE,
            category: [stage],
            isStageOf: { ...night },
          } satisfies SleepStage,
        }) satisfies ExperienceAction
    ),
  ];
}

function measure(reading: Measurement, you: Person): MeasureAction {
  const when = reading.timestamp
    ? { timestamp: reading.timestamp }
    : { startTime: reading.startTime!, endTime: reading.endTime! };
  const instrument: Device[] = reading.device
    ? [
        {
          '@type': 'Device',
          '@key': ['@type', 'source', 'handle'],
          source: SOURCE,
          handle: reading.device,
          name: reading.device,
        },
      ]
    : [];
  return {
    '@type': 'MeasureAction',
    '@key':
      reading.logId === undefined
        ? [
            '@type',
            'source',
            ...Object.keys(when),
            ...Object.keys(reading.values).map(property => `object.${property}`),
          ]
        : ['@type', 'source', 'sourceId'],
    source: SOURCE,
    ...(reading.logId !== undefined && { sourceId: String(reading.logId) }),
    ...when,
    agent: you,
    object: { ...you, ...reading.values } as Person,
    ...(instrument.length > 0 && { instrument }),
  };
}
