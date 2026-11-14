import { Record } from '@chronicle.app/etl';
import { POST_PARAMS } from '../../utils/TwitterApi.js';
import { TwitterApiExtractor, postData } from './TwitterApiExtractor.js';

/**
 * Your tweets, retweets, and replies, newest first, with their photos and
 * videos. A retweet comes with the post it retweets. X returns only the most
 * recent 3,200, and none before November 2010; older ones come from the
 * archive.
 */
export class TwitterApiTweetsExtractor extends TwitterApiExtractor {
  static override description = 'Tweets';
  static override recordTypes = ['tweets'];
  static override default = true;

  protected override async *read() {
    for await (const { tweet, retweeted } of this.timeline(
      `/2/users/${this.user.id}/tweets`,
      POST_PARAMS
    )) {
      yield { tweet, data: { type: 'tweet', ...postData(tweet, retweeted) } };
    }
  }

  override occurredAt(record: Record): Date | undefined {
    const { created_at } = record.data as { created_at?: string };
    return created_at ? new Date(created_at) : undefined;
  }
}
