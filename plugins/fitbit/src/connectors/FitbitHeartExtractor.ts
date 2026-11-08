import type { Record } from '@chronicle.app/etl';
import { fitbitTime } from '../time.js';
import FitbitArchiveExtractor from './FitbitArchiveExtractor.js';
import type { Measurement } from './measurement.js';

interface HeartRateEntry {
  dateTime: string;
  value: { bpm: number; confidence: number };
}

interface RestingEntry {
  dateTime: string;
  value: { date: string | null; value: number; error: number };
}

const DAY = 24 * 60 * 60_000;

/**
 * Every heart rate reading, one every few seconds, and each day's resting
 * heart rate. The readings are in a file for each local day,
 * `heart_rate-2022-07-15.json`, with times in UTC, so a run reads one day at a
 * time, newest first. A whole archive can hold tens of millions of them.
 */
export default class FitbitHeartExtractor extends FitbitArchiveExtractor {
  static override description = 'Heart rate readings and resting heart rate';
  static override recordTypes = ['heart'];

  async *extract(): AsyncGenerator<Record> {
    const resting = await this.restingDays();
    let next = 0;
    let count = 0;
    for (const { path, date } of await this.series('Physical Activity', 'heart_rate')) {
      if (!this.mayHold(date)) continue;
      const readings = (await this.files.readJson<HeartRateEntry[]>(path))
        .map(entry => ({ at: fitbitTime(entry.dateTime), ...entry.value }))
        .filter(({ at }) => this.inRange(at))
        .sort((a, b) => b.at - a.at);
      for (const { at, bpm, confidence } of readings) {
        // A day's resting heart rate comes before the readings taken in it.
        while (next < resting.length && Date.parse(resting[next].startTime!) >= at) {
          if (this.shouldStopExtracting(count++)) return;
          yield this.record(resting[next++]);
        }
        if (this.shouldStopExtracting(count++)) return;
        const reading: Measurement = {
          timestamp: new Date(at).toISOString(),
          values: { heartRate: bpm },
          confidence,
        };
        yield this.record(reading);
      }
    }
    for (; next < resting.length; next++) {
      if (this.shouldStopExtracting(count++)) return;
      yield this.record(resting[next]);
    }
  }

  /**
   * The days with a resting heart rate, newest first, each over its local
   * day. The files list every day, with zero on a day without one.
   */
  private async restingDays(): Promise<Measurement[]> {
    const days = new Map<string, number>();
    const files = await this.series('Physical Activity', 'resting_heart_rate');
    for await (const { value } of this.entries<RestingEntry>(files)) {
      if (!value?.date || !(value.value > 0)) continue;
      const midnight = fitbitTime(`${value.date} 00:00:00`);
      days.set(new Date(midnight).toISOString().slice(0, 10), value.value);
    }
    const found: Measurement[] = [];
    for (const [date, value] of days) {
      if (!this.mayHold(date)) continue;
      const midnight = Date.parse(`${date}T00:00:00Z`);
      const start = await this.clock.instant(midnight);
      if (!this.inRange(start)) continue;
      found.push({
        startTime: new Date(start).toISOString(),
        endTime: new Date(await this.clock.instant(midnight + DAY)).toISOString(),
        values: { restingHeartRate: Math.round(value * 100) / 100 },
      });
    }
    return found.sort((a, b) => Date.parse(b.startTime!) - Date.parse(a.startTime!));
  }

  override titleOf(record: Record): string | undefined {
    const { heartRate, restingHeartRate } = (record.data as Measurement).values;
    return heartRate === undefined
      ? `Resting heart rate ${restingHeartRate}`
      : `Heart rate ${heartRate}`;
  }
}
