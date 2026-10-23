import { Record, type Survey } from '@chronicle.app/etl';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { type LinkedInAccount, LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

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
    const account = this.profile();
    if (!account) return;
    yield this.createRecordWithArchiveContext({ ...account });
  }

  /**
   * The profile a run reads, as of when LinkedIn compiled the export: it has
   * no time of its own, and dates its sighting to that.
   */
  override async survey(): Promise<Survey> {
    if (!this.profile()) return { profile: { count: 0 } };
    return { profile: { count: 1, ...(this.compiledAt && { asOf: this.compiledAt }) } };
  }

  /** The account, when the export names its member at all. */
  private profile(): LinkedInAccount | undefined {
    const account = this.accountInfo;
    return account.name || account.handle || account.email ? account : undefined;
  }

  override async determineCount(): Promise<number> {
    return 1;
  }
}
