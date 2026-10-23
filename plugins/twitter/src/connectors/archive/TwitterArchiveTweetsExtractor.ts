import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
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
    try {
      // Load account info first
      this.accountInfo = await this.loadAccountInfo();

      yield* this.processTweets(`data/tweets.js`);
    } catch (error) {
      throw new Error(`Failed to process Twitter tweets: ${error}`);
    }
  }

  private async *processTweets(filePath: string): AsyncGenerator<Record> {
    try {
      let count = 0;
      for (const tweet of await this.loadTweets(filePath)) {
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
    } catch (error) {
      this.logger.warn('Could not process tweets', { error: String(error) });
    }
  }

  /** The archive's tweets within since and until, as it writes them. */
  private async loadTweets(filePath: string) {
    const content = await this.files.readText(filePath);
    return this.parseTwitterJS(content, 'tweets')
      .map(item => item.tweet)
      .filter(tweet => tweet && this.isWithinDateRange(new Date(tweet.created_at)));
  }

  override async determineCount(): Promise<number | null> {
    try {
      const tweetsContent = await this.files.readText(`data/tweets.js`);
      const tweetsData = this.parseTwitterJS(tweetsContent, 'tweets');
      return tweetsData.length;
    } catch {
      return null;
    }
  }

  /** The tweets a run reads and when they were posted. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const tweets = await this.loadTweets(`data/tweets.js`);
    return {
      tweets: this.surveyOf(
        tweets.map(tweet => new Date(tweet.created_at)),
        options
      ),
    };
  }
}
