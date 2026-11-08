import type { Record } from '@chronicle.app/etl';
import { fitbitTime } from '../time.js';
import FitbitArchiveExtractor from './FitbitArchiveExtractor.js';
import type { Measurement } from './measurement.js';

export interface WeightLog {
  logId: number;
  weight: number;
  bmi?: number;
  fat?: number;
  /** The local date, `MM/DD/YY`. */
  date: string;
  /** The local time, `HH:MM:SS`. */
  time: string;
  /** What logged it: a scale, such as `Aria`, or `API` for an app or the website. */
  source?: string;
}

const KG_PER_POUND = 0.453_592_37;
// Sources that are a Fitbit scale, rather than an app or the website.
const SCALES = new Set(['Aria', 'AriaAir', 'Aria2']);

/**
 * Your weight, as each scale or app logged it, at its local time. The
 * archive gives a weight without its unit. It's in pounds even for a metric
 * profile, but each log also has its BMI, which says which unit it's in
 * given your height.
 */
export default class FitbitBodyMeasurementsExtractor extends FitbitArchiveExtractor {
  static override description = 'Your weight';
  static override recordTypes = ['body-measurements'];

  async *extract(): AsyncGenerator<Record> {
    const logs = new Map<number, WeightLog>();
    const files = await this.series('Personal & Account', 'weight');
    for await (const log of this.entries<WeightLog>(files)) logs.set(log.logId, log);
    const found: Array<{ log: WeightLog; at: number }> = [];
    for (const log of logs.values()) {
      const wall = fitbitTime(`${log.date} ${log.time}`);
      if (!this.mayHold(new Date(wall).toISOString().slice(0, 10))) continue;
      const at = await this.clock.instant(wall);
      if (this.inRange(at)) found.push({ log, at });
    }
    found.sort((a, b) => b.at - a.at);
    let count = 0;
    for (const { log, at } of found) {
      if (this.shouldStopExtracting(count)) break;
      const weight: Measurement = {
        timestamp: new Date(at).toISOString(),
        values: { weight: Math.round(kilograms(log, this.profile.height) * 1000) / 1000 },
        logId: log.logId,
        ...(log.source && SCALES.has(log.source) && { device: log.source }),
        log,
      };
      yield this.record(weight);
      count++;
    }
  }

  override titleOf(record: Record): string | undefined {
    return `${(record.data as Measurement).values.weight} kg`;
  }
}

/**
 * A weight in kilograms. Read as pounds and as kilograms, it implies two
 * heights through its BMI, and the unit is the one whose height is nearer
 * yours. Without a BMI or a height, it's taken as pounds, as the archive
 * writes it.
 */
export function kilograms({ weight, bmi }: WeightLog, height?: number): number {
  if (!(bmi && bmi > 0 && height)) return weight * KG_PER_POUND;
  const asPounds = Math.sqrt((weight * KG_PER_POUND) / bmi);
  const asKilograms = Math.sqrt(weight / bmi);
  return Math.abs(asKilograms - height) < Math.abs(asPounds - height)
    ? weight
    : weight * KG_PER_POUND;
}
