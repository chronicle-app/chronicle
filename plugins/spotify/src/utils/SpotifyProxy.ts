import { ApiAuthError, ApiProxy } from '@chronicle.app/etl';
import { TokenHelper } from '@chronicle.app/auth';

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{
    id: string;
    name: string;
  }>;
  album: {
    id: string;
    name: string;
    release_date: string;
    images: Array<{
      url: string;
      height: number;
      width: number;
    }>;
  };
  duration_ms: number;
  explicit: boolean;
  external_urls: {
    spotify: string;
  };
  popularity: number;
  preview_url?: string;
}

export interface SpotifyRecentlyPlayed {
  track: SpotifyTrack;
  played_at: string;
  context?: {
    type: string;
    href: string;
    external_urls: {
      spotify: string;
    };
  };
}

export interface SpotifySavedTrack {
  added_at: string;
  track: SpotifyTrack;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description?: string;
  public: boolean;
  collaborative: boolean;
  tracks: {
    total: number;
  };
  external_urls: {
    spotify: string;
  };
  images: Array<{
    url: string;
    height?: number;
    width?: number;
  }>;
  owner: {
    id: string;
    display_name?: string;
  };
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  external_urls: {
    spotify: string;
  };
  images: Array<{
    url: string;
    height: number;
    width: number;
  }>;
  followers: {
    total: number;
  };
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  artists: Array<{
    id: string;
    name: string;
  }>;
  album_type: string;
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  images: Array<{
    url: string;
    height?: number;
    width?: number;
  }>;
  external_urls: {
    spotify: string;
  };
  genres: string[];
  popularity: number;
}

export interface SpotifySavedAlbum {
  added_at: string;
  album: SpotifyAlbum;
}

export interface SpotifyUser {
  id: string;
  display_name?: string;
  email?: string;
  external_urls: {
    spotify: string;
  };
  followers: {
    total: number;
  };
  images: Array<{
    url: string;
    height?: number;
    width?: number;
  }>;
  country?: string;
}

export default class SpotifyProxy extends ApiProxy {
  constructor(accessToken?: string) {
    super({
      baseURL: 'https://api.spotify.com/v1',
      headers: {
        'Content-Type': 'application/json',
      },
      pageDelayMs: 100,
    });

    // If token provided, use it directly
    if (accessToken) {
      this.setAccessToken(accessToken);
    }
  }

  /**
   * Ensure we have a valid access token, using stored credentials if available
   */
  public async initialize(): Promise<void> {
    // If we already have an access token, we're good
    if (this.accessToken) {
      return;
    }

    // Try to get token from stored credentials
    const token = await TokenHelper.getValidToken('spotify');
    this.setAccessToken(token);
  }

  public async getRecentlyPlayed(
    options: {
      since?: Date;
      until?: Date;
      limit?: number;
    } = {}
  ): Promise<SpotifyRecentlyPlayed[]> {
    await this.initialize();

    const params: { limit: number; after?: number; before?: number } = {
      limit: Math.min(options.limit || 50, 50), // Spotify max is 50
    };

    if (options.since) {
      params.after = options.since.getTime();
    }

    if (options.until) {
      params.before = options.until.getTime();
    }

    try {
      const data = await this.request<{ items?: SpotifyRecentlyPlayed[] }>({
        url: '/me/player/recently-played',
        method: 'GET',
        params,
      });

      return data.items || [];
    } catch (error) {
      if (error instanceof ApiAuthError) {
        throw new ApiAuthError('Spotify rejected the stored credentials', {
          hint: "Sign in with your app's client ID and secret: `chronicle auth login spotify --client-id <id> --client-secret <secret>`\nGet them at https://developer.spotify.com/dashboard",
          cause: error,
        });
      }
      throw error;
    }
  }

  public async getSavedTracks(limit?: number): Promise<SpotifySavedTrack[]> {
    await this.initialize();

    const batchSize = 50; // Spotify max per request

    return this.paginateOffset<SpotifySavedTrack>({
      pageSize: batchSize,
      limit,
      fetchPage: async offset => {
        const data = await this.request<{ items?: SpotifySavedTrack[] }>({
          url: '/me/tracks',
          method: 'GET',
          params: { limit: batchSize, offset },
        });
        return data.items || [];
      },
    });
  }

  public async getSavedAlbums(limit?: number): Promise<SpotifySavedAlbum[]> {
    await this.initialize();

    const batchSize = 50; // Spotify max per request

    return this.paginateOffset<SpotifySavedAlbum>({
      pageSize: batchSize,
      limit,
      fetchPage: async offset => {
        const data = await this.request<{ items?: SpotifySavedAlbum[] }>({
          url: '/me/albums',
          method: 'GET',
          params: { limit: batchSize, offset },
        });
        return data.items || [];
      },
    });
  }

  public async getPlaylists(): Promise<SpotifyPlaylist[]> {
    const pageSize = 50; // Spotify max per request

    return this.paginateOffset<SpotifyPlaylist>({
      pageSize,
      fetchPage: async offset => {
        const data = await this.request<{ items?: SpotifyPlaylist[] }>({
          url: '/me/playlists',
          method: 'GET',
          params: { limit: pageSize, offset },
        });
        return data.items || [];
      },
    });
  }

  public async getPlaylistTracks(playlistId: string, limit?: number): Promise<any[]> {
    await this.initialize();

    const batchSize = 50; // Spotify max per request

    return this.paginateOffset<any>({
      pageSize: batchSize,
      limit,
      fetchPage: async offset => {
        const data = await this.request<{ items?: any[] }>({
          url: `/playlists/${playlistId}/tracks`,
          method: 'GET',
          params: {
            limit: batchSize,
            offset,
            fields:
              'items(added_at,track(id,name,artists,album,duration_ms,external_urls,popularity)),total',
          },
        });
        return data.items || [];
      },
    });
  }

  public async getTopTracks(
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term'
  ): Promise<SpotifyTrack[]> {
    const data = await this.request<{ items?: SpotifyTrack[] }>({
      url: '/me/top/tracks',
      method: 'GET',
      params: {
        time_range: timeRange,
        limit: 50,
      },
    });

    return data.items || [];
  }

  public async getTopArtists(
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term'
  ): Promise<SpotifyArtist[]> {
    const data = await this.request<{ items?: SpotifyArtist[] }>({
      url: '/me/top/artists',
      method: 'GET',
      params: {
        time_range: timeRange,
        limit: 50,
      },
    });

    return data.items || [];
  }

  public async getUser(): Promise<SpotifyUser> {
    await this.initialize();

    return this.request<SpotifyUser>({
      url: '/me',
      method: 'GET',
    });
  }

  public async getTotalItemCount(): Promise<number> {
    try {
      // Get user profile to check if API is working
      await this.request({ url: '/me', method: 'GET' });

      // Get counts from different endpoints
      const [savedTracksResponse, playlistsResponse] = await Promise.all([
        this.request<{ total?: number }>({
          url: '/me/tracks',
          method: 'GET',
          params: { limit: 1 },
        }),
        this.request<{ total?: number }>({
          url: '/me/playlists',
          method: 'GET',
          params: { limit: 1 },
        }),
      ]);

      const savedTracksCount = savedTracksResponse.total || 0;
      const playlistsCount = playlistsResponse.total || 0;

      // Recently played doesn't have a total count, so we estimate based on recent activity
      const recentlyPlayedCount = 50; // Approximate recent activity

      return savedTracksCount + playlistsCount + recentlyPlayedCount;
    } catch (error) {
      throw new Error(`Failed to get item count: ${error}`);
    }
  }
}
