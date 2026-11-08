import { wallTime } from './time.js';

/** A stage as `:SleepStage` allows it. */
export type Stage = 'awake' | 'light' | 'deep' | 'REM' | 'asleep';

/**
 * Fitbit's levels. A night with stages has `wake`, `light`, `deep`, and
 * `rem`. A classic night, from older trackers or a short sleep, has `asleep`,
 * `restless`, and `awake`, and Fitbit counts restless time as time awake.
 * `unknown`, a stretch the tracker couldn't read, isn't a stage.
 */
const STAGES: { [level: string]: Stage } = {
  wake: 'awake',
  awake: 'awake',
  restless: 'awake',
  light: 'light',
  deep: 'deep',
  rem: 'REM',
  asleep: 'asleep',
};

export interface SleepLevel {
  dateTime: string;
  level: string;
  seconds: number;
}

export interface SleepLog {
  logId: number;
  dateOfSleep: string;
  startTime: string;
  endTime: string;
  duration: number;
  mainSleep: boolean;
  type: 'stages' | 'classic';
  logType: string;
  levels: { data?: SleepLevel[]; shortData?: SleepLevel[]; summary?: unknown };
  [field: string]: unknown;
}

/** One stage, by its wall-clock start and end read as UTC. */
export interface Segment {
  stage: Stage;
  start: number;
  end: number;
}

/**
 * A night's stages, in order and not overlapping. A night with stages lists
 * brief wakes, under three minutes, apart from the stage they interrupt, in
 * `shortData`. Each one cuts the time it covers out of the stages it falls
 * in, as the Fitbit app shows it. Neighbouring stages that come out the same,
 * such as a classic night's restless and awake, are one.
 */
export function stagesOf(log: Pick<SleepLog, 'levels'>): Segment[] {
  let segments = (log.levels.data ?? []).flatMap(level => segmentOf(level));
  for (const wake of (log.levels.shortData ?? []).flatMap(level => segmentOf(level))) {
    segments = segments.flatMap(segment => cut(segment, wake));
    segments.push({ ...wake, stage: 'awake' });
  }
  segments.sort((a, b) => a.start - b.start);
  const merged: Segment[] = [];
  for (const segment of segments) {
    const last = merged.at(-1);
    if (last && last.stage === segment.stage && last.end === segment.start) last.end = segment.end;
    else merged.push({ ...segment });
  }
  return merged;
}

function segmentOf({ dateTime, level, seconds }: SleepLevel): Segment[] {
  const stage = STAGES[level];
  if (!stage || !(seconds > 0)) return [];
  const start = wallTime(dateTime);
  return [{ stage, start, end: start + seconds * 1000 }];
}

/** The parts of a segment outside another. */
function cut(segment: Segment, by: Segment): Segment[] {
  if (by.end <= segment.start || by.start >= segment.end) return [segment];
  return [
    ...(segment.start < by.start ? [{ ...segment, end: by.start }] : []),
    ...(by.end < segment.end ? [{ ...segment, start: by.end }] : []),
  ];
}
