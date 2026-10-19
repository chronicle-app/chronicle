import { BODY_MEASUREMENTS } from '../readings.js';
import AppleHealthExtractor, { type Found } from './AppleHealthExtractor.js';

/** Weight and sleeping wrist temperature, which Health counts among body measurements. */
export default class AppleHealthBodyMeasurementsExtractor extends AppleHealthExtractor {
  static override description = 'Weight and sleeping wrist temperature';
  static override recordTypes = ['body-measurements'];

  protected read(): AsyncGenerator<Found> {
    return this.readingsOf(BODY_MEASUREMENTS);
  }
}
