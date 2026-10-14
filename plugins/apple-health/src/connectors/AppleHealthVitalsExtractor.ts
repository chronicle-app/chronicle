import { Record } from '@chronicle.app/etl';
import { parseDevice } from '../device.js';
import { readExport } from '../health.js';
import { BLOOD_PRESSURE, BLOOD_PRESSURE_PARTS, type Reading, VITALS } from '../readings.js';
import AppleHealthExtractor from './AppleHealthExtractor.js';

const TYPES = new Set(Object.keys(VITALS));
const CORRELATIONS = new Set([BLOOD_PRESSURE]);

/**
 * Respiratory rate, sleeping wrist temperature, blood oxygen, and blood
 * pressure. A blood pressure is read from the correlation that pairs its two
 * values. The export repeats both values as separate samples, which are
 * skipped.
 */
export default class AppleHealthVitalsExtractor extends AppleHealthExtractor {
  static override description =
    'Respiratory rate, sleeping wrist temperature, blood oxygen, and blood pressure';

  static override recordTypes = ['vitals'];

  protected async *records(): AsyncGenerator<Record> {
    const wanted = { records: TYPES, correlations: CORRELATIONS };
    for await (const element of readExport(this.health, wanted)) {
      if (element.kind === 'record') {
        const { sample } = element;
        const reading = this.readingOf(sample, VITALS[sample.type], parseDevice(sample.device));
        if (reading && this.inRange(reading.start)) yield this.recordOf(reading);
        continue;
      }
      const { correlation } = element;
      // One reading with both values, timed and sourced as the correlation is.
      const parts = correlation.samples.flatMap(sample => {
        const part = BLOOD_PRESSURE_PARTS[sample.type];
        return part ? [this.readingOf(sample, part, null)] : [];
      });
      if (parts.length === 0 || parts.includes(null)) continue;
      const reading: Reading = {
        ...this.measuredBy(correlation, parseDevice(correlation.device)),
        values: Object.assign({}, ...parts.map(part => part!.values)),
      };
      if (this.inRange(reading.start)) yield this.recordOf(reading);
    }
  }
}
