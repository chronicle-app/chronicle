import { ApiProxy } from '@chronicle.app/etl';

export interface LastfmTrack {
  name: string;
  mbid: string;
  url: string;
  artist: {
    name: string;
    mbid: string;
    url: string;
    image?: Array<{ '#text': string; size: string }>;
  };
  album?: {
    '#text': string;
    mbid: string;
  };
  image?: Array<{ '#text': string; size: string }>;
  date: {
    uts: string;
    '#text': string;
  };
  '@attr'?: {
    nowplaying?: string;
  };
}

export interface LastfmRecentTracksResponse {
  recenttracks: {
    track: LastfmTrack[];
    '@attr': {
      user: string;
      totalPages: string;
      page: string;
      total: string;
    };
  };
}

export interface LastfmLovedTracksResponse {
  lovedtracks: {
    track: LastfmTrack[];
    '@attr': {
      user: string;
      totalPages: string;
      page: string;
      total: string;
    };
  };
}

export interface LastfmFriend {
  name: string;
  realname?: string;
  url: string;
  country?: string;
  playcount?: string;
  image?: Array<{ '#text': string; size: string }>;
  registered?: { unixtime: string; '#text': number };
}

export interface LastfmFriendsResponse {
  friends: {
    user?: LastfmFriend[] | LastfmFriend;
    '@attr': {
      user: string;
      totalPages: string;
      page: string;
      total: string;
    };
  };
}

export interface LastfmUser {
  name: string;
  realname?: string;
  url?: string;
  country?: string;
  age?: string;
  gender?: string;
  subscriber?: string;
  playcount?: string;
  playlists?: string;
  bootstrap?: string;
  registered?: {
    unixtime: string;
    '#text': number;
  };
  image?: Array<{ '#text': string; size: string }>;
}

export interface LastfmUserResponse {
  user: LastfmUser;
}

// Last.fm returns `friends.user` as an array, a bare object (single friend), or
// omits it entirely (no friends). Normalize to an array.
function normalizeFriends(response: LastfmFriendsResponse): LastfmFriend[] {
  const { user } = response.friends;
  if (!user) return [];
  return Array.isArray(user) ? user : [user];
}

export default class LastfmProxy extends ApiProxy {
  // Last.fm authenticates with an `api_key` query parameter, not a bearer
  // header, so the key lives here and the base's accessToken stays unset.
  private apiKey: string;
  private username: string;

  constructor(apiKey: string, username: string, baseUrl?: string) {
    super({
      baseURL: baseUrl || 'https://ws.audioscrobbler.com/2.0',
      headers: {
        'User-Agent': 'Chronicle/1.0',
      },
      pageDelayMs: 200,
    });
    this.apiKey = apiKey;
    this.username = username;
  }

  // The API key and username are resolved by the extractor's setup() and
  // handed in via the constructor, so there is nothing left to load here.
  public async initialize(): Promise<void> {}

  public async getRecentTracks(
    options: {
      since?: Date;
      until?: Date;
      limit?: number;
    } = {}
  ): Promise<LastfmTrack[]> {
    return this.paginateByPage<LastfmTrack>({
      limit: options.limit,
      fetchPage: async page => {
        const response = await this.fetchRecentTracks(page, options);
        return {
          items: this.filterTracks(response.recenttracks.track),
          totalPages: Number.parseInt(response.recenttracks['@attr'].totalPages),
        };
      },
    });
  }

  public async getLovedTracks(
    options: {
      limit?: number;
    } = {}
  ): Promise<LastfmTrack[]> {
    return this.paginateByPage<LastfmTrack>({
      limit: options.limit,
      fetchPage: async page => {
        const response = await this.fetchLovedTracks(page);
        return {
          items: response.lovedtracks.track,
          totalPages: Number.parseInt(response.lovedtracks['@attr'].totalPages),
        };
      },
    });
  }

  public async getFriends(
    options: {
      limit?: number;
    } = {}
  ): Promise<LastfmFriend[]> {
    return this.paginateByPage<LastfmFriend>({
      limit: options.limit,
      fetchPage: async page => {
        const response = await this.fetchFriends(page);
        return {
          items: normalizeFriends(response),
          totalPages: Number.parseInt(response.friends['@attr']?.totalPages ?? '1'),
        };
      },
    });
  }

  private async fetchFriends(page: number): Promise<LastfmFriendsResponse> {
    return this.request<LastfmFriendsResponse>({
      url: '/',
      method: 'GET',
      params: {
        method: 'user.getFriends',
        user: this.username,
        api_key: this.apiKey,
        format: 'json',
        page: page.toString(),
        limit: '200',
      },
    });
  }

  public async getFriendsCount(): Promise<number> {
    const response = await this.fetchFriends(1);
    return Number.parseInt(response.friends['@attr']?.total ?? '0');
  }

  private async fetchRecentTracks(
    page: number,
    options: {
      since?: Date;
      until?: Date;
    }
  ): Promise<LastfmRecentTracksResponse> {
    const params: any = {
      method: 'user.getRecentTracks',
      user: this.username,
      api_key: this.apiKey,
      format: 'json',
      page: page.toString(),
      limit: '200',
    };

    if (options.since) {
      params.from = Math.floor(options.since.getTime() / 1000).toString();
    }

    if (options.until) {
      params.to = Math.floor(options.until.getTime() / 1000).toString();
    }

    return this.request<LastfmRecentTracksResponse>({
      url: '/',
      method: 'GET',
      params,
    });
  }

  private async fetchLovedTracks(page: number): Promise<LastfmLovedTracksResponse> {
    return this.request<LastfmLovedTracksResponse>({
      url: '/',
      method: 'GET',
      params: {
        method: 'user.getLovedTracks',
        user: this.username,
        api_key: this.apiKey,
        format: 'json',
        page: page.toString(),
        limit: '200',
      },
    });
  }

  private filterTracks(tracks: LastfmTrack[]): LastfmTrack[] {
    return tracks.filter(track => {
      // Skip currently playing tracks (they don't have timestamps yet)
      if (track['@attr']?.nowplaying) return false;

      // Skip tracks with invalid timestamps
      if (track.date?.uts === '0') return false;

      return true;
    });
  }

  public async getItemCount(): Promise<number> {
    const response = await this.fetchRecentTracks(1, {});
    return Number.parseInt(response.recenttracks['@attr'].total);
  }

  public async getLovedCount(): Promise<number> {
    const response = await this.fetchLovedTracks(1);
    return Number.parseInt(response.lovedtracks['@attr'].total);
  }

  public async getUserInfo(): Promise<LastfmUser> {
    const response = await this.request<LastfmUserResponse>({
      url: '/',
      method: 'GET',
      params: {
        method: 'user.getinfo',
        user: this.username,
        api_key: this.apiKey,
        format: 'json',
      },
    });
    return response.user;
  }
}
