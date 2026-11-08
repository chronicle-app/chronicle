import type { Record } from '@chronicle.app/etl';
import { type SleepLog, type Stage, stagesOf } from '../sleep.js';
import { wallTime } from '../time.js';
import FitbitArchiveExtractor from './FitbitArchiveExtractor.js';

/** What a sleep record holds: the log as the archive has it, and its times as instants. */
export interface Sleep {
  startTime: string;
  endTime: string;
  stages: Array<{ stage: Stage; startTime: string; endTime: string }>;
  log: SleepLog;
}

/**
 * Nights and naps, each with its stages. The archive splits them into files
 * of 30 days, `sleep-2017-05-10.json`, and a night near the edge of one is in
 * the next as well, with different 30-day averages, so each night is read
 * once, by its ID. Its times are local, without an offset, and all in one
 * offset: on a night the clocks change, its span on the clock is how long it
 * lasted. The offset is the one the night started in.
 */
export default class FitbitSleepExtractor extends FitbitArchiveExtractor {
  static override description = 'Nights and naps, with their sleep stages';
  static override recordTypes = ['sleep'];
  static override default = true;

  async *extract(): AsyncGenerator<Record> {
    const logs = new Map<number, SleepLog>();
    for await (const log of this.entries<SleepLog>(await this.series('Sleep', 'sleep'))) {
      if (!logs.has(log.logId)) logs.set(log.logId, log);
    }
    const found: Array<{ log: SleepLog; start: number }> = [];
    for (const log of logs.values()) {
      if (!this.mayHold(log.startTime.slice(0, 10))) continue;
      const start = await this.clock.instant(wallTime(log.startTime));
      if (this.inRange(start)) found.push({ log, start });
    }
    found.sort((a, b) => b.start - a.start);
    let count = 0;
    for (const { log, start } of found) {
      if (this.shouldStopExtracting(count)) break;
      // A night's times are all in the offset it started in: on a night the
      // clocks change, its span on the clock is still how long it lasted.
      const offset = wallTime(log.startTime) - start;
      const sleep: Sleep = {
        startTime: instant(wallTime(log.startTime), offset),
        endTime: instant(wallTime(log.endTime), offset),
        stages: stagesOf(log).map(({ stage, start, end }) => ({
          stage,
          startTime: instant(start, offset),
          endTime: instant(end, offset),
        })),
        log,
      };
      yield this.record(sleep);
      count++;
    }
  }

  override titleOf(record: Record): string | undefined {
    return (record.data as Sleep).log.mainSleep ? 'Night’s sleep' : 'Nap';
  }
}

/** A wall-clock time in an offset, as an instant. */
function instant(wall: number, offset: number): string {
  return new Date(wall - offset).toISOString();
}
