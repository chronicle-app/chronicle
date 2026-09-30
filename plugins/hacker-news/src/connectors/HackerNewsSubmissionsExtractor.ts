import { Record } from '@chronicle.app/etl';
import HackerNewsExtractor from './HackerNewsExtractor.js';

/** Item types a user submits, as opposed to comments on them. */
export const SUBMISSION_TYPES = new Set(['story', 'poll', 'job']);

export default class HackerNewsSubmissionsExtractor extends HackerNewsExtractor {
  static override description = 'Stories, polls, and job posts you submitted';
  static override recordTypes: string[] = ['submissions'];
  static override default = true;
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const item of this.ownItems({ stopAtSince: true })) {
      if (!SUBMISSION_TYPES.has(item.type ?? '') || !this.inRange(item)) continue;
      yield this.createRecord(item, this.context({ recordType: 'submissions' }));
    }
  }
}
