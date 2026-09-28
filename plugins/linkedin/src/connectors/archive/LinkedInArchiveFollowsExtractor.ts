import { Record } from '@chronicle.app/etl';
import { parseLongStamp } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * `Company Follows.csv` — the organizations and topic pages you follow, with
 * the moment you followed each, newest-first.
 *
 * LinkedIn files a topic page ("Scrum", "Web Development") in the same list as
 * a real employer, and gives neither an id — the organization's display name is
 * all we get, so it is what the follow points at.
 */
export class LinkedInArchiveFollowsExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveFollowsExtractor
> {
  static override description = 'Companies you follow';

  static override recordTypes = ['follows'];
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    const rows = await this.readCsv('Company Follows.csv');

    const follows = rows
      .map(row => ({
        organization: row.Organization?.trim(),
        followedAt: parseLongStamp(row['Followed On']),
      }))
      .filter(follow => follow.organization)
      .sort((a, b) => ((a.followedAt ?? '') < (b.followedAt ?? '') ? 1 : -1));

    let count = 0;
    for (const follow of follows) {
      if (this.shouldStopExtracting(count)) break;
      if (!this.withinWindow(follow.followedAt)) continue;
      yield this.createRecordWithArchiveContext({
        ...follow,
        occurredAt: follow.followedAt,
      });
      count++;
    }
  }

  override async determineCount(): Promise<number> {
    return (await this.readCsv('Company Follows.csv')).length;
  }
}
