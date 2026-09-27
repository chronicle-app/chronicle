import { Record } from '@chronicle.app/etl';
import { YouTubeBaseExtractor } from './YouTubeBaseExtractor.js';

export class YouTubeSubscriptionsExtractor extends YouTubeBaseExtractor<
  typeof YouTubeSubscriptionsExtractor
> {
  static override description = 'Channel subscriptions';
  static override recordTypes = ['subscriptions'];
  // Re-running re-reports the full current subscription list with each
  // channel's latest title/avatar, so sightings belong at read time.
  static override temporality = 'snapshot' as const;

  async *extract(): AsyncGenerator<Record> {
    const subscriptions = await this.proxy.getSubscriptions({
      limit: this.getEffectiveLimit() ?? undefined,
    });

    this.logger.info(`Retrieved ${subscriptions.length} subscriptions from YouTube`);

    for (const subscription of subscriptions) {
      yield this.createRecordWithUser(subscription, {
        recordType: 'subscriptions',
      });
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      return await this.proxy.getSubscriptionsCount();
    } catch {
      return null;
    }
  }
}
