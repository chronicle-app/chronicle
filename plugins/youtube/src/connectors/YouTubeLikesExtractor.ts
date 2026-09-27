import { Record } from '@chronicle.app/etl';
import { YouTubeBaseExtractor } from './YouTubeBaseExtractor.js';
import { YouTubePlaylistItem, YouTubeVideo } from '../utils/YouTubeProxy.js';

export interface YouTubeLikedVideo {
  item: YouTubePlaylistItem;
  video?: YouTubeVideo;
}

export class YouTubeLikesExtractor extends YouTubeBaseExtractor<typeof YouTubeLikesExtractor> {
  static override description = 'Liked videos';
  static override recordTypes = ['likes'];
  static override default = true;

  private likesPlaylistId!: string;

  override async setup(): Promise<void> {
    await super.setup();

    const likesPlaylistId = this.user?.contentDetails?.relatedPlaylists?.likes;
    if (!likesPlaylistId) {
      throw new Error('YouTube API did not expose a likes playlist for this account');
    }
    this.likesPlaylistId = likesPlaylistId;
  }

  async *extract(): AsyncGenerator<Record> {
    const { since, until } = this.config;

    // The likes playlist is newest-first, so a `since` bound also caps how far
    // we need to paginate; without one we fetch to the configured limit.
    let items = await this.proxy.getLikes({
      likesPlaylistId: this.likesPlaylistId,
      limit: since ? undefined : (this.getEffectiveLimit() ?? undefined),
    });

    items = items.filter(item => {
      const likedAt = new Date(item.snippet.publishedAt);
      if (since && likedAt <= since) return false;
      if (until && likedAt > until) return false;
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

    this.logger.info(`Retrieved ${items.length} liked videos from YouTube`);

    for (const item of items) {
      const liked: YouTubeLikedVideo = {
        item,
        video: detailsById.get(item.snippet.resourceId.videoId),
      };
      yield this.createRecordWithUser(liked, { recordType: 'likes' });
    }
  }

  override async determineCount(): Promise<number | null> {
    try {
      return await this.proxy.getPlaylistItemCount(this.likesPlaylistId);
    } catch {
      return null;
    }
  }
}
