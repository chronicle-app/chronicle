import { Record } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/**
 * Extract the follow graph from an Instagram data export.
 *
 * `following.json` (`relationships_following[]`) and `followers_1.json` (a flat
 * list) each carry a handle and a per-follow timestamp — a real dated stream,
 * not just a snapshot. Both fold to a `FollowAction`; direction sets which side
 * is the account owner.
 */
export class InstagramArchiveFollowsExtractor extends InstagramArchiveExtractor {
  static override description = 'Follows and followers';

  static override recordTypes = ['follows'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;

  async *extract(): AsyncGenerator<Record> {
    let index = 0;
    index = yield* this.extractFollowing(index);
    yield* this.extractFollowers(index);
  }

  private async *extractFollowing(startIndex: number): AsyncGenerator<Record, number> {
    let index = startIndex;
    let data: any;
    try {
      data = await this.readInstagramJson('connections/followers_and_following/following.json');
    } catch {
      return index;
    }
    for (const rel of data?.relationships_following ?? []) {
      const entry = rel?.string_list_data?.[0];
      // Dialects disagree on where the handle lives: `value` (2025), `title`
      // (older), or only recoverable from the profile href.
      const handle = entry?.value || rel?.title || this.handleFromHref(entry?.href);
      if (!handle || !entry?.timestamp) continue;
      if (!this.inRange(entry.timestamp)) continue;
      if (this.shouldStopExtracting(index)) return index;
      yield this.emitFollow('following', handle, entry.timestamp);
      index++;
    }
    return index;
  }

  private async *extractFollowers(startIndex: number): AsyncGenerator<Record> {
    let index = startIndex;
    let data: any;
    try {
      data = await this.readInstagramJson('connections/followers_and_following/followers_1.json');
    } catch {
      return;
    }
    for (const rel of Array.isArray(data) ? data : []) {
      const entry = rel?.string_list_data?.[0];
      const handle = entry?.value || this.handleFromHref(entry?.href);
      if (!handle || !entry?.timestamp) continue;
      if (!this.inRange(entry.timestamp)) continue;
      if (this.shouldStopExtracting(index)) return;
      yield this.emitFollow('follower', handle, entry.timestamp);
      index++;
    }
  }

  private emitFollow(
    direction: 'following' | 'follower',
    handle: string,
    timestamp: number
  ): Record {
    return this.createRecordWithArchiveContext(
      {
        type: 'follows',
        direction,
        handle,
        timestamp: this.convertInstagramTimestamp(timestamp),
      },
      { originalData: { direction, handle, timestamp } }
    );
  }

  private handleFromHref(href: string | undefined): string | null {
    if (!href) return null;
    const match = href.match(/instagram\.com\/(?:_u\/)?([^/?#]+)/);
    return match ? match[1] : null;
  }
}
