import { Record } from '@chronicle.app/etl';
import { parseDevice } from '../device.js';
import { readElectrocardiograms } from '../ecg.js';
import { readExport } from '../health.js';
import { HEART, RHYTHMS, type Reading } from '../readings.js';
import AppleHealthExtractor from './AppleHealthExtractor.js';

const TYPES = new Set(Object.keys(HEART));

/**
 * Heart readings: heart rate, resting and walking heart rate, heart rate
 * variability, and recovery after exercise, then the rhythm each ECG found.
 */
export default class AppleHealthHeartExtractor extends AppleHealthExtractor {
  static override description =
    'Heart rate, resting and walking heart rate, HRV, recovery, and ECG rhythm';

  static override recordTypes = ['heart'];

  protected async *records(): AsyncGenerator<Record> {
    for await (const element of readExport(this.health, { records: TYPES })) {
      if (element.kind !== 'record') continue;
      const { sample } = element;
      const reading = this.readingOf(sample, HEART[sample.type], parseDevice(sample.device));
      if (reading && this.inRange(reading.start)) yield this.recordOf(reading);
    }
    for (const ecg of await readElectrocardiograms(this.health)) {
      // An inconclusive recording says nothing about the rhythm.
      if (!RHYTHMS.has(ecg.classification) || !this.inRange(ecg.recorded)) continue;
      // The recording names the watch's hardware, but not the watch.
      const reading: Reading = {
        type: 'Electrocardiogram',
        app: false,
        device: ecg.hardware ? { hardware: ecg.hardware } : null,
        start: ecg.recorded,
        end: ecg.recorded,
        values: { heartRhythm: ecg.classification },
      };
      yield this.recordOf(reading);
    }
  }
}
