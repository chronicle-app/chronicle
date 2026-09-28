import { ApiProxy } from '@chronicle.app/etl';
import { resolveCredentials } from '@chronicle.app/auth';

export interface PinboardPost {
  href: string;
  description: string;
  extended: string;
  meta: string;
  hash: string;
  time: string;
  shared: string;
  toread: string;
  tags: string;
}

export default class PinboardProxy extends ApiProxy {
  // Pinboard authenticates with an `auth_token` query parameter, not a bearer
  // header, so the token lives here and the base's accessToken stays unset.
  private authToken: string;
  private username: string;

  public getAccessToken(): string {
    return this.authToken;
  }

  public getUsername(): string {
    return this.username;
  }

  constructor(accessToken?: string) {
    super({
      baseURL: 'https://api.pinboard.in',
      headers: {
        'User-Agent': 'Chronicle/1.0',
      },
    });
    this.authToken = accessToken || '';
    this.username = '';
  }

  public async initialize(): Promise<void> {
    // `auth set` stores the token under the canonical `accessToken`;
    // `apiKey` is kept as a fallback for any older stored credential.
    const { accessToken } = await resolveCredentials(
      'pinboard',
      {
        accessToken: { from: ['accessToken', 'apiKey'] },
      },
      {
        overrides: { accessToken: this.authToken || undefined },
        errorMessage: 'Pinboard API key is required. Set it via --api-key or store in credentials.',
      }
    );
    this.authToken = accessToken as string;

    // Extract username from API key (format is username:token)
    this.username = this.authToken.split(':')[0] || '';
  }

  private authParams(): URLSearchParams {
    return new URLSearchParams({
      auth_token: this.authToken,
      format: 'json',
    });
  }

  public async getAllPosts(
    options: {
      fromdt?: Date;
      todt?: Date;
      tag?: string;
    } = {}
  ): Promise<PinboardPost[]> {
    const params = this.authParams();
    params.append('meta', 'yes');

    if (options.fromdt) {
      params.append('fromdt', options.fromdt.toISOString());
    }

    if (options.todt) {
      params.append('todt', options.todt.toISOString());
    }

    if (options.tag) {
      params.append('tag', options.tag);
    }

    return this.request<PinboardPost[]>({
      url: `/v1/posts/all?${params.toString()}`,
      method: 'GET',
    });
  }

  public async getRecentPosts(
    options: {
      tag?: string;
      count?: number;
    } = {}
  ): Promise<PinboardPost[]> {
    const params = this.authParams();
    params.append('meta', 'yes');

    if (options.tag) {
      params.append('tag', options.tag);
    }

    if (options.count) {
      params.append('count', options.count.toString());
    }

    const data = await this.request<{ posts: PinboardPost[] }>({
      url: `/v1/posts/recent?${params.toString()}`,
      method: 'GET',
    });
    return data.posts;
  }

  public async getAllTags(): Promise<Record<string, number>> {
    return this.request<Record<string, number>>({
      url: `/v1/tags/get?${this.authParams().toString()}`,
      method: 'GET',
    });
  }
}
