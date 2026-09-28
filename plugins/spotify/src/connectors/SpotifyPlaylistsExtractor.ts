import { Record } from '@chronicle.app/etl';
import { z } from 'zod';
import { SpotifyBaseExtractor } from './SpotifyBaseExtractor.js';

export class SpotifyPlaylistsExtractor extends SpotifyBaseExtractor<
  typeof SpotifyPlaylistsExtractor
> {
  static override description = 'Tracks added to playlists';
  static override recordTypes = ['playlist-tracks'];

  static override schema = SpotifyBaseExtractor.schema.extend({
    // No additional schema - inherits limit from base Extractor
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof SpotifyPlaylistsExtractor.schema>;

    try {
      let recordCount = 0;
      const maxRecords = config.limit || Number.POSITIVE_INFINITY;

      const playlists = await this.proxy.getPlaylists();

      for (const playlist of playlists) {
        if (this.shouldStopExtracting(recordCount)) break;

        const tracks = await this.proxy.getPlaylistTracks(playlist.id, maxRecords - recordCount);

        for (const trackItem of tracks) {
          if (this.shouldStopExtracting(recordCount)) break;

          if (!trackItem.added_at) {
            continue;
          }

          yield this.createRecordWithUser(
            {
              ...trackItem,
              playlist: {
                id: playlist.id,
                name: playlist.name,
                external_urls: playlist.external_urls,
              },
            },
            {
              recordType: 'playlist-tracks',
            }
          );
          recordCount++;
        }
      }
    } catch (error) {
      this.logger.error('Error extracting Spotify playlists data');
      throw error;
    }
  }
}
