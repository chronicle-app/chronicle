import { Record } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/**
 * Extract authored comments from an Instagram data export.
 *
 * `post_comments_1.json` (a bare array) and `reels_comments.json` (wrapped in
 * `comments_reels_comments`) share one item shape: the text, a `Media Owner`
 * handle, and a `Time`. The export carries no post shortcode or comment id, so
 * the commented-on post can't be attached; the comment is imported text-only
 * as a memory jog ("I commented 'Congrats!' to alex.example"). The
 * transformer keys it on the natural composite (owner, text, authored time) —
 * no synthesized opaque id.
 */
export class InstagramArchiveCommentsExtractor extends InstagramArchiveExtractor {
  static override description = 'Comments you wrote';

  static override recordTypes = ['comments'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;

  async *extract(): AsyncGenerator<Record> {
    const items = [
      ...(await this.readInstagramArray('your_instagram_activity/comments/post_comments_1.json')),
      ...(await this.readInstagramArray('your_instagram_activity/comments/reels_comments.json')),
    ];

    let index = 0;
    for (const item of items) {
      const sm = item?.string_map_data ?? {};
      const text = sm.Comment?.value;
      const owner = sm['Media Owner']?.value;
      const timestamp = sm.Time?.timestamp;
      if (!text || !timestamp) continue;
      if (!this.inRange(timestamp)) continue;
      if (this.shouldStopExtracting(index)) break;

      yield this.createRecordWithArchiveContext(
        {
          type: 'comments',
          text: this.fixInstagramTextEncoding(text),
          ownerHandle: owner || undefined,
          timestamp: this.convertInstagramTimestamp(timestamp),
        },
        { originalData: item }
      );
      index++;
    }
  }
}
