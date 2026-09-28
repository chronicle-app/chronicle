import { Record } from '@chronicle.app/etl';
import { YouTubeBaseExtractor } from './YouTubeBaseExtractor.js';
import { YouTubeLikedVideo } from './YouTubeLikesExtractor.js';

export class YouTubeUploadsExtractor extends YouTubeBaseExtractor<typeof YouTubeUploadsExtractor> {
  static override description = 'Videos uploaded to your channel';
  static override recordTypes = ['uploads'];

  private uploadsPlaylistId!: string;

  override async setup(): Promise<void> {
    await super.setup();

    const uploadsPlaylistId = this.user?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      throw new Error('YouTube API did not expose an uploads playlist for this account');
    }
    this.uploadsPlaylistId = uploadsPlaylistId;
  }

  async *extract(): AsyncGenerator<Record> {
    const { since, until } = this.config;

    let items = await this.proxy.getPlaylistItems(this.uploadsPlaylistId, {
      limit: since ? undefined : (this.getEffectiveLimit() ?? undefined),
    });

    items = items.filter(item => {
      const publishedAt = new Date(item.snippet.publishedAt);
      if (since && publishedAt <= since) return false;
      if (until && publishedAt > until) return false;
      return true;
    });

    const limit = this.getEffectiveLimit();
    if (limit !== null) {
      items = items.slice(0, limit);
    }

    const details = await this.proxy.getVideoDetails(
      items.map(item => item.snippet.resourceId.videoId)
    );
    const detailsById = new Map(details.map(video => [video.id, video]));

    this.logger.info(`Retrieved ${items.length} uploads from YouTube`);

    for (const item of items) {
      const upload: YouTubeLikedVideo = {
        item,
        video: detailsById.get(item.snippet.resourceId.videoId),
      };
      yield this.createRecordWithUser(upload, { recordType: 'uploads' });
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      return await this.proxy.getPlaylistItemCount(this.uploadsPlaylistId);
    } catch {
      return null;
    }
  }
}
