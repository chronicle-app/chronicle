import { Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { SpotifyBaseExtractor } from './SpotifyBaseExtractor.js';

export class SpotifyRecentlyPlayedExtractor extends SpotifyBaseExtractor<
  typeof SpotifyRecentlyPlayedExtractor
> {
  static override description = 'Recently played tracks';
  static override recordTypes = ['listens'];
  static override default = true;

  static override schema = SpotifyBaseExtractor.schema.extend({
    // No additional schema - inherits since/until/limit from base Extractor
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof SpotifyRecentlyPlayedExtractor.schema>;

    try {
      let recordCount = 0;

      const items = await this.proxy.getRecentlyPlayed({
        since: config.since,
        until: config.until,
        limit: config.limit,
      });

      for (const item of items) {
        if (this.shouldStopExtracting(recordCount)) break;

        yield this.createRecordWithUser(item, {
          recordType: 'listens',
        });
        recordCount++;
      }
    } catch (error) {
      this.logger.error('Error extracting Spotify recently played data');
      throw error;
    }
  }
}
