import type { Record } from '@chronicle.app/etl';
import { fitbitTime } from '../time.js';
import FitbitArchiveExtractor from './FitbitArchiveExtractor.js';

export interface ExerciseLog {
  logId: number;
  activityName: string;
  activityTypeId: number;
  /** When it started, in UTC, `MM/DD/YY HH:MM:SS`. */
  startTime: string;
  /** How long it lasted, in milliseconds. */
  duration: number;
  distance?: number;
  distanceUnit?: string;
  source?: { type: string; name: string; id: string };
  logType: string;
  lastModified?: string;
  [field: string]: unknown;
}

/** What an exercise record holds: the log as the archive has it, and when it ran. */
export interface Exercise {
  startTime: string;
  endTime: string;
  log: ExerciseLog;
}

/**
 * Walks, runs, rides, and workouts: the ones the tracker noticed, the ones
 * started on it, and the ones an app such as Strava sent. The archive pages
 * them a hundred to a file, `exercise-0.json`, `exercise-100.json`, and on.
 */
export default class FitbitExercisesExtractor extends FitbitArchiveExtractor {
  static override description = 'Walks, runs, rides, and workouts';
  static override recordTypes = ['exercises'];
  static override default = true;

  async *extract(): AsyncGenerator<Record> {
    const prefix = `${this.root}Physical Activity/exercise-`;
    const logs = new Map<number, ExerciseLog>();
    for (const path of await this.files.list(prefix)) {
      if (!/^\d+\.json$/.test(path.slice(prefix.length))) continue;
      for (const log of await this.files.readJson<ExerciseLog[]>(path)) logs.set(log.logId, log);
    }
    const found = [...logs.values()]
      .map(log => ({ log, start: fitbitTime(log.startTime) }))
      .filter(({ start }) => this.inRange(start))
      .sort((a, b) => b.start - a.start);
    let count = 0;
    for (const { log, start } of found) {
      if (this.shouldStopExtracting(count)) break;
      const exercise: Exercise = {
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + log.duration).toISOString(),
        log,
      };
      yield this.record(exercise, log.lastModified ? fitbitTime(log.lastModified) : undefined);
      count++;
    }
  }

  override titleOf(record: Record): string | undefined {
    return (record.data as Exercise).log.activityName;
  }
}
