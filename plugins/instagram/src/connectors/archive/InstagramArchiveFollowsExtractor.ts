import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/** One follow a run reads, before it's a record. */
interface Follow {
  direction: 'following' | 'follower';
  handle: string;
  timestamp: number;
}

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
    for await (const { direction, handle, timestamp } of this.follows()) {
      if (this.shouldStopExtracting(index)) return;
      yield this.emitFollow(direction, handle, timestamp);
      index++;
    }
  }

  /** The follows a run reads, both ways, and when each began. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const follows = this.emptySurvey(options);
    for await (const follow of this.follows()) {
      this.tally(follows, new Date(follow.timestamp * 1000));
    }
    return { follows };
  }

  /** The accounts followed, then the followers, in the run's window. */
  private async *follows(): AsyncGenerator<Follow> {
    yield* this.following();
    yield* this.followers();
  }

  private async *following(): AsyncGenerator<Follow> {
    let data: any;
    try {
      data = await this.readInstagramJson('connections/followers_and_following/following.json');
    } catch {
      return;
    }
    for (const rel of data?.relationships_following ?? []) {
      const entry = rel?.string_list_data?.[0];
      // Dialects disagree on where the handle lives: `value` (2025), `title`
      // (older), or only recoverable from the profile href.
      const handle = entry?.value || rel?.title || this.handleFromHref(entry?.href);
      if (!handle || !entry?.timestamp) continue;
      if (!this.inRange(entry.timestamp)) continue;
      yield { direction: 'following', handle, timestamp: entry.timestamp };
    }
  }

  private async *followers(): AsyncGenerator<Follow> {
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
      yield { direction: 'follower', handle, timestamp: entry.timestamp };
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
