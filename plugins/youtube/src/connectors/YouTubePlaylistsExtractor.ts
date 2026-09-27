import { Record } from '@chronicle.app/etl';
import { YouTubeBaseExtractor } from './YouTubeBaseExtractor.js';
import { YouTubePlaylist, YouTubePlaylistItem, YouTubeVideo } from '../utils/YouTubeProxy.js';

export interface YouTubePlaylistItemRecord {
  playlist: YouTubePlaylist;
  item: YouTubePlaylistItem;
  video?: YouTubeVideo;
}

export class YouTubePlaylistsExtractor extends YouTubeBaseExtractor<
  typeof YouTubePlaylistsExtractor
> {
  static override description = 'Your playlists and their videos';
  static override recordTypes = ['playlists', 'playlist-items'];
  // Re-running re-reports every playlist and its current membership, so
  // sightings belong at read time and removed items depart via completeness.
  static override temporality = 'snapshot' as const;

  async *extract(): AsyncGenerator<Record> {
    const playlists = await this.proxy.getPlaylists();

    this.logger.info(`Retrieved ${playlists.length} playlists from YouTube`);

    let recordCount = 0;

    for (const playlist of playlists) {
      if (this.shouldStopExtracting(recordCount)) break;

      yield this.createRecordWithUser(playlist, { recordType: 'playlists' });
      recordCount++;

      const items = await this.proxy.getPlaylistItems(playlist.id);
      const details = await this.proxy.getVideoDetails(
        items.map(item => item.snippet.resourceId.videoId)
      );
      const detailsById = new Map(details.map(video => [video.id, video]));

      for (const item of items) {
        if (this.shouldStopExtracting(recordCount)) break;

        const data: YouTubePlaylistItemRecord = {
          playlist,
          item,
          video: detailsById.get(item.snippet.resourceId.videoId),
        };
        yield this.createRecordWithUser(data, {
          recordType: 'playlist-items',
        });
        recordCount++;
      }
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      const playlists = await this.proxy.getPlaylists();
      return playlists.reduce(
        (sum, playlist) => sum + 1 + (playlist.contentDetails?.itemCount ?? 0),
        0
      );
    } catch {
      return null;
    }
  }
}
