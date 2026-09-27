import { Record } from '@chronicle.app/etl';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * The member themself: name, headline, location, and the primary email — one
 * record, assembled from `Profile.csv` and `Email Addresses.csv` by the base
 * class's account read.
 *
 * A re-read of current state, so `snapshot`: a headline changes, and the change
 * belongs at the moment we saw it rather than back-dated to whenever the
 * account was created.
 */
export class LinkedInArchiveProfileExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveProfileExtractor
> {
  static override description = 'Profile: name, headline, location, email';

  static override recordTypes = ['profile'];
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    const account = this.accountInfo;
    if (!account.name && !account.handle && !account.email) return;
    yield this.createRecordWithArchiveContext({ ...account });
  }

  override async determineCount(): Promise<number> {
    return 1;
  }
}
