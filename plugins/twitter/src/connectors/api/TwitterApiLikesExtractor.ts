import { Record } from '@chronicle.app/etl';
import { TwitterApiExtractor, likedOrSaved, timeOf } from './TwitterApiExtractor.js';

/**
 * The tweets you liked, most recently liked first, each with when you liked
 * it (`likedAt`). X doesn't document the time; it's read from the paging
 * tokens, at about one request per like, and a dozen or so for each of the
 * newest few. A like whose time can't be found has `likedDuring`, the
 * stretch it's known to be in, instead. Each post comes with who posted it,
 * for the handle its page is under; X bills each author.
 */
export class TwitterApiLikesExtractor extends TwitterApiExtractor {
  static override description = 'Likes';
  static override recordTypes = ['likes'];
  static override default = true;

  protected override async *read() {
    for await (const { tweet, at, during } of this.timedPosts(
      `/2/users/${this.user.id}/liked_tweets`,
      5
    )) {
      yield {
        tweet,
        data: {
          type: 'like',
          ...likedOrSaved(tweet),
          ...(at && { likedAt: at }),
          ...(during && { likedDuring: during }),
        },
      };
    }
  }

  override occurredAt(record: Record): Date | undefined {
    return timeOf(record.data, 'likedAt', 'likedDuring');
  }
}
