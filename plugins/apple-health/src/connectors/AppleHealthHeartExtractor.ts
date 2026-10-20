import { readElectrocardiograms } from '../ecg.js';
import { BLOOD_PRESSURE, ELECTROCARDIOGRAM, HEART, RHYTHMS } from '../readings.js';
import AppleHealthExtractor, { type Found } from './AppleHealthExtractor.js';

/**
 * Heart readings: heart rate, resting and walking heart rate, heart rate
 * variability, recovery after exercise, and blood pressure, then the rhythm
 * each ECG found.
 */
export default class AppleHealthHeartExtractor extends AppleHealthExtractor {
  static override description =
    'Heart rate, resting and walking heart rate, HRV, recovery, blood pressure, and ECG rhythm';

  static override recordTypes = ['heart'];

  protected async *read(): AsyncGenerator<Found> {
    yield* this.readingsOf(HEART, [BLOOD_PRESSURE]);
    if (!this.wants(ELECTROCARDIOGRAM)) return;
    for (const ecg of await readElectrocardiograms(this.health)) {
      // An inconclusive recording says nothing about the rhythm.
      if (!RHYTHMS.has(ecg.classification)) continue;
      // The recording names the watch's hardware, but not the watch.
      const device = ecg.hardware ? { hardware: ecg.hardware } : null;
      yield {
        by: this.share({ type: ELECTROCARDIOGRAM, app: false, device }),
        start: Date.parse(ecg.recorded),
        end: Date.parse(ecg.recorded),
        values: { heartRhythm: ecg.classification },
      };
    }
  }
}
