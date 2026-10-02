import { ApiAuthError, ApiProxy } from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';

export interface YouTubeThumbnails {
  default?: { url: string; width?: number; height?: number };
  medium?: { url: string; width?: number; height?: number };
  high?: { url: string; width?: number; height?: number };
  standard?: { url: string; width?: number; height?: number };
  maxres?: { url: string; width?: number; height?: number };
}

export interface YouTubeSelfChannel {
  id: string;
  snippet: {
    title: string;
    description?: string;
    customUrl?: string;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails?: {
    relatedPlaylists?: {
      likes?: string;
      uploads?: string;
    };
  };
}

export interface YouTubePlaylistItem {
  id: string;
  snippet: {
    publishedAt: string;
    title: string;
    description?: string;
    thumbnails?: YouTubeThumbnails;
    channelId: string;
    channelTitle: string;
    resourceId: {
      kind: string;
      videoId: string;
    };
    // Channel that uploaded the video (present on playlistItems since 2020)
    videoOwnerChannelId?: string;
    videoOwnerChannelTitle?: string;
  };
}

export interface YouTubeVideo {
  id: string;
  snippet: {
    publishedAt: string;
    channelId: string;
    channelTitle: string;
    title: string;
    description?: string;
    thumbnails?: YouTubeThumbnails;
    tags?: string[];
  };
  contentDetails?: {
    duration?: string; // ISO-8601, e.g. PT4M13S
    definition?: string;
  };
}

export interface YouTubePlaylist {
  id: string;
  snippet: {
    publishedAt: string; // when the playlist was created
    title: string;
    description?: string;
    thumbnails?: YouTubeThumbnails;
    channelId: string;
  };
  status?: {
    privacyStatus?: string; // public | private | unlisted
  };
  contentDetails?: {
    itemCount?: number;
  };
}

export interface YouTubeSubscription {
  id: string;
  snippet: {
    publishedAt: string; // when the subscription was made
    title: string; // subscribed channel's title
    description?: string;
    thumbnails?: YouTubeThumbnails;
    resourceId: {
      kind: string;
      channelId: string;
    };
  };
}

export default class YouTubeProxy extends ApiProxy {
  constructor(accessToken?: string) {
    super({
      baseURL: 'https://www.googleapis.com/youtube/v3',
      headers: {
        'Content-Type': 'application/json',
      },
      pageDelayMs: 100,
    });

    if (accessToken) {
      this.setAccessToken(accessToken);
    }
  }

  public async initialize(): Promise<void> {
    await this.ensureAuthenticated();
  }

  // Lazily resolves a token from the keychain the first time a request needs
  // one; a token passed to the constructor short-circuits this.
  private async ensureAuthenticated(): Promise<void> {
    if (this.accessToken) {
      return;
    }

    const token = await TokenHelper.getValidToken('youtube');
    this.setAccessToken(token);
  }

  // Keep the actionable re-auth guidance the generic 401 mapping would lose.
  protected override mapError(error: unknown): unknown {
    const mapped = super.mapError(error);
    if (mapped instanceof ApiAuthError) {
      return new ApiAuthError('YouTube rejected the stored credentials', {
        hint: "Run `chronicle auth login youtube --client-id <id> --client-secret <secret>` with your app's credentials. Create them at https://console.cloud.google.com/apis/credentials.",
        cause: mapped,
      });
    }
    return mapped;
  }

  private async get<T = any>(path: string, params: Record<string, any>): Promise<T> {
    await this.ensureAuthenticated();
    return this.request<T>({ url: path, method: 'GET', params });
  }

  /** Self channel (drives the @me agent) plus the likes playlist id. */
  public async getUser(): Promise<YouTubeSelfChannel> {
    const data = await this.get<{ items?: YouTubeSelfChannel[] }>('/channels', {
      part: 'snippet,contentDetails',
      mine: true,
    });

    const channel = data.items?.[0];
    if (!channel) {
      throw new Error('YouTube API returned no channel for this account');
    }

    return channel;
  }

  /**
   * Liked videos, newest first, from the account's likes playlist.
   * snippet.publishedAt on a playlist item is when the video was liked.
   */
  public async getLikes(options: {
    likesPlaylistId: string;
    limit?: number;
  }): Promise<YouTubePlaylistItem[]> {
    return this.getPlaylistItems(options.likesPlaylistId, {
      limit: options.limit,
    });
  }

  /** Items of any playlist. snippet.publishedAt is when the item was added. */
  public async getPlaylistItems(
    playlistId: string,
    options: { limit?: number } = {}
  ): Promise<YouTubePlaylistItem[]> {
    return this.paginateCursor<YouTubePlaylistItem>({
      limit: options.limit,
      fetchPage: async cursor => {
        const data = await this.get<{
          items?: YouTubePlaylistItem[];
          nextPageToken?: string;
        }>('/playlistItems', {
          part: 'snippet',
          playlistId,
          maxResults: 50,
          ...(cursor && { pageToken: cursor }),
        });
        return { items: data.items ?? [], cursor: data.nextPageToken };
      },
    });
  }

  /** The account's own playlists (created playlists, not saved ones). */
  public async getPlaylists(options: { limit?: number } = {}): Promise<YouTubePlaylist[]> {
    return this.paginateCursor<YouTubePlaylist>({
      limit: options.limit,
      fetchPage: async cursor => {
        const data = await this.get<{
          items?: YouTubePlaylist[];
          nextPageToken?: string;
        }>('/playlists', {
          part: 'snippet,contentDetails,status',
          mine: true,
          maxResults: 50,
          ...(cursor && { pageToken: cursor }),
        });
        return { items: data.items ?? [], cursor: data.nextPageToken };
      },
    });
  }

  /** Hydrate video details (duration, tags, canonical channel) in batches. */
  public async getVideoDetails(ids: string[]): Promise<YouTubeVideo[]> {
    let details: YouTubeVideo[] = [];

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const data = await this.get<{ items?: YouTubeVideo[] }>('/videos', {
        part: 'snippet,contentDetails',
        id: chunk.join(','),
        maxResults: 50,
      });
      details = details.concat(data.items ?? []);
      await this.delay(100);
    }

    return details;
  }

  public async getSubscriptions(options: { limit?: number }): Promise<YouTubeSubscription[]> {
    return this.paginateCursor<YouTubeSubscription>({
      limit: options.limit,
      fetchPage: async cursor => {
        const data = await this.get<{
          items?: YouTubeSubscription[];
          nextPageToken?: string;
        }>('/subscriptions', {
          part: 'snippet',
          mine: true,
          maxResults: 50,
          ...(cursor && { pageToken: cursor }),
        });
        return { items: data.items ?? [], cursor: data.nextPageToken };
      },
    });
  }

  public async getPlaylistItemCount(playlistId: string): Promise<number> {
    const data = await this.get<{ pageInfo?: { totalResults?: number } }>('/playlistItems', {
      part: 'id',
      playlistId,
      maxResults: 1,
    });
    return data.pageInfo?.totalResults ?? 0;
  }

  public async getSubscriptionsCount(): Promise<number> {
    const data = await this.get<{ pageInfo?: { totalResults?: number } }>('/subscriptions', {
      part: 'id',
      mine: true,
      maxResults: 1,
    });
    return data.pageInfo?.totalResults ?? 0;
  }
}
