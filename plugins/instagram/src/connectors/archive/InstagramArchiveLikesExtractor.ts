import { Record } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/**
 * Extract likes on posts and stories from an Instagram data export.
 *
 * Two dialects per file. `liked_posts.json`: older exports carry
 * `label_values` (URL/Caption/Owner); 2025 exports carry
 * `{title: <owner>, string_list_data: [{href: <permalink>, value: 👍,
 * timestamp}]}` under a `likes_media_likes` wrapper. Both key the external post
 * by its permalink shortcode and fold to a `LikeAction` on an external `Post`.
 *
 * `story_likes.json`: older exports carry a `/stories/<handle>/<id>` URL that
 * keys the story; 2025 exports carry only the owner handle and a timestamp —
 * no target identity at all — so those entries are skipped (never synthesize
 * an id) and the drop is logged.
 */
export class InstagramArchiveLikesExtractor extends InstagramArchiveExtractor {
  static override description = 'Post and story likes';

  static override recordTypes = ['likes'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;

  /**
   * The liked post's shortcode (or story id) — the like entry's only id, and
   * Instagram's own: a post is liked once, so it identifies the entry.
   */
  override keyOf(record: Record): string | null {
    return (record.data as { targetId?: string }).targetId ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    let index = 0;
    index = yield* this.extractPostLikes(index);
    yield* this.extractStoryLikes(index);
  }

  private async *extractPostLikes(startIndex: number): AsyncGenerator<Record, number> {
    let index = startIndex;
    const items = await this.readInstagramArray('your_instagram_activity/likes/liked_posts.json');
    for (const item of items) {
      const labels = this.labelMap(item);
      const entry = item.string_list_data?.[0];
      const url: string | undefined = labels.URL ?? entry?.href;
      const shortcode = this.shortcodeFromUrl(url);
      const timestamp = item.timestamp ?? entry?.timestamp;
      if (!shortcode || !timestamp) continue;
      if (!this.inRange(timestamp)) continue;
      if (this.shouldStopExtracting(index)) return index;

      yield this.emitLike({
        targetId: shortcode,
        url: this.permalinkFromUrl(url) ?? undefined,
        // The new dialect's `value` is the 👍 marker, not a caption.
        caption: labels.Caption,
        ownerHandle: labels.Owner || item.title || undefined,
        // A liked /p/ URL doesn't say whether the post was a feed post, so
        // only reels get a sourceFormat — same rule as our own posts.
        ...(/\/reel\//.test(url || '') && { sourceFormat: 'reel' }),
        timestamp,
      });
      index++;
    }
    return index;
  }

  private async *extractStoryLikes(startIndex: number): AsyncGenerator<Record> {
    let index = startIndex;
    let unkeyable = 0;
    const items = await this.readInstagramArray(
      'your_instagram_activity/story_interactions/story_likes.json'
    );
    for (const item of items) {
      const labels = this.labelMap(item);
      const url: string | undefined = labels.URL;
      const match = url?.match(/\/stories\/([^/]+)\/(\d+)/);
      const timestamp = item.timestamp ?? item.string_list_data?.[0]?.timestamp;
      if (!match) {
        // 2025 dialect: owner + timestamp only, no story id → nothing to key.
        if (timestamp) unkeyable++;
        continue;
      }
      if (!timestamp) continue;
      if (!this.inRange(timestamp)) continue;
      if (this.shouldStopExtracting(index)) break;

      yield this.emitLike({
        targetId: match[2],
        url,
        caption: labels.Caption,
        ownerHandle: match[1],
        sourceFormat: 'story',
        timestamp,
      });
      index++;
    }
    if (unkeyable > 0) {
      this.logger.warn(
        `Skipped ${unkeyable} story likes with no story id (this export dialect carries only owner + time)`
      );
    }
  }

  private emitLike(data: {
    targetId: string;
    url?: string;
    caption?: string;
    ownerHandle?: string;
    sourceFormat?: string;
    timestamp: number;
  }): Record {
    return this.createRecordWithArchiveContext(
      {
        type: 'likes',
        targetId: data.targetId,
        url: data.url,
        caption: this.fixInstagramTextEncoding(data.caption || '') || undefined,
        ownerHandle: data.ownerHandle,
        sourceFormat: data.sourceFormat,
        timestamp: this.convertInstagramTimestamp(data.timestamp),
      },
      { originalData: data }
    );
  }
}
