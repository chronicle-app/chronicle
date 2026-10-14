import { Record } from '@chronicle.app/etl';
import { type HealthSample, readExport } from '../health.js';
import { groupSleep } from '../sleep.js';
import AppleHealthExtractor from './AppleHealthExtractor.js';

const SLEEP = new Set(['HKCategoryTypeIdentifierSleepAnalysis']);

/**
 * Nights and naps, each with its stages. The export doesn't keep a source's
 * sleep samples in order, so they're all collected before they're grouped.
 * There are far fewer of them than heart readings.
 */
export default class AppleHealthSleepExtractor extends AppleHealthExtractor {
  static override description = 'Nights and naps, with their sleep stages';
  static override recordTypes = ['sleep'];

  protected async *records(): AsyncGenerator<Record> {
    const samples: HealthSample[] = [];
    for await (const element of readExport(this.health, { records: SLEEP })) {
      if (element.kind === 'record') samples.push(element.sample);
    }
    for (const period of groupSleep(samples)) {
      if (!this.inRange(period.start)) continue;
      yield this.recordOf({ ...period, ...this.sourceOf(period, null) });
    }
  }
}
