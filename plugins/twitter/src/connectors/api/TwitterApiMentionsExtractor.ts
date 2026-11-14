import { Record } from '@chronicle.app/etl';
import { POST_PARAMS_WITH_AUTHORS } from '../../utils/TwitterApi.js';
import { TwitterApiExtractor, postData } from './TwitterApiExtractor.js';

/**
 * Other people's tweets that mention you, newest first, with who posted
 * each and their photos and videos. X returns only the most recent 800, and
 * none before November 2010. Each author X returns is billed.
 */
export class TwitterApiMentionsExtractor extends TwitterApiExtractor {
  static override description = 'Tweets that mention you';
  static override recordTypes = ['mentions'];
  static override default = true;

  protected override async *read() {
    for await (const { tweet, retweeted } of this.timeline(
      `/2/users/${this.user.id}/mentions`,
      POST_PARAMS_WITH_AUTHORS
    )) {
      yield { tweet, data: { type: 'mention', ...postData(tweet, retweeted) } };
    }
  }

  override occurredAt(record: Record): Date | undefined {
    const { created_at } = record.data as { created_at?: string };
    return created_at ? new Date(created_at) : undefined;
  }
}
