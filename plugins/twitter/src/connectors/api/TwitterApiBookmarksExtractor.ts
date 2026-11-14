import { Record } from '@chronicle.app/etl';
import { TwitterApiExtractor, likedOrSaved, timeOf } from './TwitterApiExtractor.js';

/**
 * The tweets you bookmarked, most recently bookmarked first, each with when
 * you bookmarked it (`bookmarkedAt`). The archive has no bookmarks. X doesn't
 * document the time; it's read from the paging tokens, one bookmark per
 * request. A bookmark whose time can't be found has `bookmarkedDuring`.
 * Each post comes with who posted it, for the handle its page is under; X
 * bills each author.
 */
export class TwitterApiBookmarksExtractor extends TwitterApiExtractor {
  static override description = 'Bookmarks';
  static override recordTypes = ['bookmarks'];
  static override default = true;

  protected override async *read() {
    for await (const { tweet, at, during } of this.timedPosts(
      `/2/users/${this.user.id}/bookmarks`,
      1
    )) {
      yield {
        tweet,
        data: {
          type: 'bookmark',
          ...likedOrSaved(tweet),
          ...(at && { bookmarkedAt: at }),
          ...(during && { bookmarkedDuring: during }),
        },
      };
    }
  }

  override occurredAt(record: Record): Date | undefined {
    return timeOf(record.data, 'bookmarkedAt', 'bookmarkedDuring');
  }
}
