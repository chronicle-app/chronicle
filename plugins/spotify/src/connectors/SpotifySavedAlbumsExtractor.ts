import { Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { SpotifyBaseExtractor } from './SpotifyBaseExtractor.js';

export class SpotifySavedAlbumsExtractor extends SpotifyBaseExtractor<
  typeof SpotifySavedAlbumsExtractor
> {
  static override description = 'Saved albums';
  static override recordTypes = ['saved-albums'];

  static override schema = SpotifyBaseExtractor.schema.extend({
    // No additional schema - inherits limit from base Extractor
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof SpotifySavedAlbumsExtractor.schema>;

    try {
      let recordCount = 0;

      const items = await this.proxy.getSavedAlbums(config.limit);

      for (const item of items) {
        if (this.shouldStopExtracting(recordCount)) break;

        yield this.createRecordWithUser(item, {
          recordType: 'saved-albums',
        });
        recordCount++;
      }
    } catch (error) {
      this.logger.error('Error extracting Spotify saved albums data');
      throw error;
    }
  }
}
