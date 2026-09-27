import { Record } from '@chronicle.app/etl';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

export class TwitterArchiveTweetsExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveTweetsExtractor
> {
  static override description = 'Tweets';
  static override recordTypes = ['tweets'];
  static override default = true;
  static override defaultTransformer = TwitterTransformer;
  static override schema = TwitterArchiveExtractor.schema;

  /** The tweet id (`id_str`) — Twitter's own id, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { id?: string }).id ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof TwitterArchiveTweetsExtractor.schema>;

    try {
      // Load account info first
      await this.loadAccountInfoFrom(config.input);

      yield* this.processTweets(`${config.input}/data/tweets.js`);
    } catch (error) {
      throw new Error(`Failed to process Twitter tweets: ${error}`);
    }
  }

  private async *processTweets(filePath: string): AsyncGenerator<Record> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const jsData = this.parseTwitterJS(content, 'tweets');

      let count = 0;
      for (const item of jsData) {
        const { tweet } = item;
        if (tweet && this.isWithinDateRange(new Date(tweet.created_at))) {
          if (this.shouldStopExtracting(count)) break;

          yield this.createRecordWithArchiveContext(
            {
              type: 'tweet',
              id: tweet.id_str,
              text: tweet.full_text || tweet.text,
              created_at: this.convertTwitterDateToISO(tweet.created_at),
              favorite_count: Number.parseInt(tweet.favorite_count) || 0,
              retweet_count: Number.parseInt(tweet.retweet_count) || 0,
              in_reply_to_status_id: tweet.in_reply_to_status_id_str,
              in_reply_to_user_id: tweet.in_reply_to_user_id_str,
              entities: tweet.entities,
              source: tweet.source,
              retweeted: tweet.retweeted,
            },
            { originalData: tweet }
          );
          count++;
        }
      }
    } catch (error) {
      console.warn(`Could not process tweets: ${error}`);
    }
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof TwitterArchiveTweetsExtractor.schema>;

    try {
      const tweetsContent = await readFile(`${config.input}/data/tweets.js`, 'utf-8');
      const tweetsData = this.parseTwitterJS(tweetsContent, 'tweets');
      return tweetsData.length;
    } catch {
      return null;
    }
  }
}
