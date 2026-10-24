import type { HealthSample } from '../health.js';
import { SLEEP } from '../readings.js';
import { groupSleep } from '../sleep.js';
import AppleHealthExtractor, { type Found } from './AppleHealthExtractor.js';

/**
 * Nights and naps, each with its stages. The export doesn't keep a source's
 * sleep samples in order, so they're all collected before they're grouped.
 */
export default class AppleHealthSleepExtractor extends AppleHealthExtractor {
  static override description = 'Nights and naps, with their sleep stages';
  static override recordTypes = ['sleep'];
  static override surveyLabel = 'sleep periods';

  protected async *read(): AsyncGenerator<Found> {
    const samples: HealthSample[] = [];
    for await (const element of this.elements([SLEEP])) {
      if (element.kind === 'record') samples.push(element.sample);
    }
    for (const { sourceName, timeZone, start, end, recorded, stages } of groupSleep(samples)) {
      yield {
        by: this.share({ ...this.sourceOf({ sourceName }, null), ...(timeZone && { timeZone }) }),
        start: Date.parse(start),
        end: Date.parse(end),
        ...(recorded && { recorded: Date.parse(recorded) }),
        stages,
      };
    }
  }
}
