import { RESPIRATORY } from '../readings.js';
import AppleHealthExtractor, { type Found } from './AppleHealthExtractor.js';

/** Respiratory rate and blood oxygen. */
export default class AppleHealthRespiratoryExtractor extends AppleHealthExtractor {
  static override description = 'Respiratory rate and blood oxygen';
  static override recordTypes = ['respiratory'];
  static override surveyLabel = 'respiratory readings';

  protected read(): AsyncGenerator<Found> {
    return this.readingsOf(RESPIRATORY);
  }
}
