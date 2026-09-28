import BlueskyExtractor from './BlueskyExtractor.js';
import { Record } from '@chronicle.app/etl';

export default class BlueskyFollowsExtractor extends BlueskyExtractor {
  static override description = 'Accounts you follow';
  static override recordTypes: string[] = ['follows'];
  static override default = true;

  /** The follow record's AT-URI — atproto's own address for it, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { viewer?: { following?: string } }).viewer?.following ?? null;
  }

  async extractRecords(): Promise<Record[]> {
    const follows = await this.proxy.getAllWithRecords(
      'getFollows',
      this.config,
      (follow: any) => follow.viewer.following
    );

    return follows.map((follow: any) =>
      this.createRecord(follow.result, { ...this.defaultContext(), atprotoRecord: follow.record })
    );
  }
}
