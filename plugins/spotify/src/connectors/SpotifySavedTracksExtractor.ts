import { Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { SpotifyBaseExtractor } from './SpotifyBaseExtractor.js';

export class SpotifySavedTracksExtractor extends SpotifyBaseExtractor<
  typeof SpotifySavedTracksExtractor
> {
  static override description = 'Saved tracks';
  static override recordTypes = ['saved-tracks'];

  static override schema = SpotifyBaseExtractor.schema.extend({
    // No additional schema - inherits limit from base Extractor
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof SpotifySavedTracksExtractor.schema>;

    try {
      let recordCount = 0;

      const items = await this.proxy.getSavedTracks(config.limit);

      for (const item of items) {
        if (this.shouldStopExtracting(recordCount)) break;

        yield this.createRecordWithUser(item, {
          recordType: 'saved-tracks',
        });
        recordCount++;
      }
    } catch (error) {
      this.logger.error('Error extracting Spotify saved tracks data');
      throw error;
    }
  }
}
