import type { Record } from '@chronicle.app/etl';
import { fitbitTime } from '../time.js';
import FitbitArchiveExtractor from './FitbitArchiveExtractor.js';
import type { Measurement } from './measurement.js';

interface StepsEntry {
  dateTime: string;
  value: string;
}

const MINUTE = 60_000;

/**
 * The steps taken in each minute, in UTC. Minutes without steps are left
 * out. The archive splits the minutes into files that don't overlap,
 * `steps-2016-01-19.json`, named for the day each starts.
 */
export default class FitbitActivityExtractor extends FitbitArchiveExtractor {
  static override description = 'Steps taken in each minute';
  static override recordTypes = ['activity'];

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const { path } of await this.series('Physical Activity', 'steps')) {
      const minutes = (await this.files.readJson<StepsEntry[]>(path))
        .map(entry => ({ at: fitbitTime(entry.dateTime), steps: Number(entry.value) }))
        .filter(({ at, steps }) => steps > 0 && this.inRange(at))
        .sort((a, b) => b.at - a.at);
      for (const { at, steps } of minutes) {
        if (this.shouldStopExtracting(count)) return;
        const minute: Measurement = {
          startTime: new Date(at).toISOString(),
          endTime: new Date(at + MINUTE).toISOString(),
          values: { stepCount: steps },
        };
        yield this.record(minute);
        count++;
      }
    }
  }

  override titleOf(record: Record): string | undefined {
    return `${(record.data as Measurement).values.stepCount} steps`;
  }
}
