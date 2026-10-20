import { ACTIVITY } from '../readings.js';
import AppleHealthExtractor, { type Found } from './AppleHealthExtractor.js';

/** Steps and active energy: amounts, each over its sample's period. */
export default class AppleHealthActivityExtractor extends AppleHealthExtractor {
  static override description = 'Steps and active energy';
  static override recordTypes = ['activity'];

  protected read(): AsyncGenerator<Found> {
    return this.readingsOf(ACTIVITY);
  }
}
