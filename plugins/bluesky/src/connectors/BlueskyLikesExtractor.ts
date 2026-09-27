import BlueskyExtractor from './BlueskyExtractor.js';
import { Record } from '@chronicle.app/etl';

export default class BlueskyLikesExtractor extends BlueskyExtractor {
  static override description = 'Posts you liked';
  static override recordTypes: string[] = ['likes'];

  /** The like record's AT-URI — atproto's own address for it, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { post?: { viewer?: { like?: string } } }).post?.viewer?.like ?? null;
  }

  async extractRecords(): Promise<Record[]> {
    const likes = await this.proxy.getAllWithRecords(
      'getLikes',
      this.config,
      (like: any) => like.post.viewer.like
    );

    return likes.map((like: any) =>
      this.createRecord(like.result, { ...this.defaultContext(), atprotoRecord: like.record })
    );
  }
}
