import { readElectrocardiograms } from '../ecg.js';
import { readExport } from '../health.js';
import { HEART, RHYTHMS } from '../readings.js';
import AppleHealthExtractor, { type Found } from './AppleHealthExtractor.js';

const TYPES = new Set(Object.keys(HEART));

/**
 * Heart readings: heart rate, resting and walking heart rate, heart rate
 * variability, and recovery after exercise, then the rhythm each ECG found.
 */
export default class AppleHealthHeartExtractor extends AppleHealthExtractor {
  static override description =
    'Heart rate, resting and walking heart rate, HRV, recovery, and ECG rhythm';

  static override recordTypes = ['heart'];

  protected async *read(): AsyncGenerator<Found> {
    for await (const element of readExport(this.health, { records: TYPES })) {
      if (element.kind !== 'record') continue;
      const { sample } = element;
      const reading = this.readingOf(sample, HEART[sample.type], this.deviceOf(sample.device));
      if (reading) yield reading;
    }
    for (const ecg of await readElectrocardiograms(this.health)) {
      // An inconclusive recording says nothing about the rhythm.
      if (!RHYTHMS.has(ecg.classification)) continue;
      // The recording names the watch's hardware, but not the watch.
      const device = ecg.hardware ? { hardware: ecg.hardware } : null;
      yield {
        by: this.share({ type: 'Electrocardiogram', app: false, device }),
        start: Date.parse(ecg.recorded),
        end: Date.parse(ecg.recorded),
        values: { heartRhythm: ecg.classification },
      };
    }
  }
}
