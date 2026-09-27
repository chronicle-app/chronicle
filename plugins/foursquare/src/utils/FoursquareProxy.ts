import { ApiProxy } from '@chronicle.app/etl';

const API_VERSION = 20_170_310;

export interface FoursquareCategory {
  id: string;
  name: string;
  primary?: boolean;
}

export interface FoursquareCheckin {
  id: string;
  createdAt: number;
  venue: {
    id: string;
    name: string;
    categories?: FoursquareCategory[];
    location: {
      lat: number;
      lng: number;
      formattedAddress?: string[];
      country?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      address?: string;
    };
  };
}

export interface FoursquareUser {
  id: string;
  firstName: string;
  lastName: string;
  canonicalUrl: string;
  photo: {
    prefix: string;
    suffix: string;
  };
}

export default class FoursquareProxy extends ApiProxy {
  // Foursquare authenticates with an `oauth_token` query parameter, not a
  // bearer header, so the token lives here and the base's accessToken stays unset.
  private oauthToken: string;

  constructor(accessToken: string) {
    super({
      baseURL: 'https://api.foursquare.com/v2/',
      headers: {
        'User-Agent': 'Chronicle/1.0',
        'Content-Type': 'application/json',
      },
    });
    this.oauthToken = accessToken;
  }

  public async initialize(): Promise<void> {
    // The access token is resolved by the extractor's own CredentialManager
    // lookup and handed to the constructor; nothing to load lazily here.
  }

  public async loadCheckins(
    options: {
      since?: Date;
      limit?: number;
    } = {}
  ): Promise<FoursquareCheckin[]> {
    return this.paginateOffset<FoursquareCheckin>({
      pageSize: 50,
      limit: options.limit,
      fetchPage: offset => this.loadCheckinPage({ limit: 50, offset, since: options.since }),
    });
  }

  public async loadSelf(): Promise<FoursquareUser> {
    const response = await this.loadEndpoint('users/self');
    return response.response.user;
  }

  private async loadCheckinPage(options: {
    limit: number;
    offset: number;
    since?: Date;
  }): Promise<FoursquareCheckin[]> {
    const params: Record<string, any> = {
      limit: options.limit,
      offset: options.offset,
    };

    if (options.since) {
      params.afterTimestamp = Math.floor(options.since.getTime() / 1000);
    }

    const response = await this.loadEndpoint('users/self/checkins', params);
    return response.response.checkins.items;
  }

  private async loadEndpoint(endpoint: string, params: Record<string, any> = {}): Promise<any> {
    return this.request<any>({
      url: endpoint,
      method: 'GET',
      params: {
        ...params,
        oauth_token: this.oauthToken,
        v: API_VERSION,
      },
    });
  }
}
