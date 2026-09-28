import BlueskyExtractor from './BlueskyExtractor.js';
import { Record } from '@chronicle.app/etl';

export default class BlueskyFollowerExtractor extends BlueskyExtractor {
  static override description = 'Accounts following you';
  static override recordTypes: string[] = ['followers'];

  /** The follower's follow record AT-URI — atproto's own address for it, stable in their repo. */
  override keyOf(record: Record): string | null {
    return (record.data as { viewer?: { followedBy?: string } }).viewer?.followedBy ?? null;
  }

  async extractRecords(): Promise<Record[]> {
    const followers = await this.proxy.getAllWithRecords(
      'getFollowers',
      this.config,
      (follower: any) => follower.viewer.followedBy
    );

    return followers.map((follower: any) =>
      this.createRecord(follower.result, {
        ...this.defaultContext(),
        atprotoRecord: follower.record,
      })
    );
  }
}
