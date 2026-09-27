import { ApiProxy } from '@chronicle.app/etl';
import { resolveCredentials } from '@chronicle.app/auth';

export default class BlueskyProxy extends ApiProxy {
  private handle: string;
  public userDid?: string;
  private pdsDomain?: string;
  private password?: string;

  constructor(
    { handle, accessToken, password } = {} as {
      accessToken?: string;
      handle?: string;
      password?: string;
    }
  ) {
    // No baseURL: every RPC names its PDS domain absolutely.
    super();
    this.handle = handle || '';
    this.setAccessToken(accessToken);
    this.password = password;
  }

  public async initialize() {
    // Load credentials if not provided
    const { handle, password } = await resolveCredentials(
      'bluesky',
      {
        handle: { from: ['handle', 'clientId'], optional: true },
        password: { from: ['password', 'clientSecret'], optional: true },
      },
      {
        overrides: { handle: this.handle || undefined, password: this.password },
      }
    );
    this.handle = handle || '';
    this.password = password;

    if (!this.handle) {
      throw new Error('Bluesky handle is required.');
    }

    try {
      this.userDid = await this.handleToDid(this.handle);
      this.pdsDomain = await BlueskyProxy.didToPdsDomain(this.userDid);
    } catch {
      throw new Error('Could not resolve handle to DID');
    }

    if (!this.accessToken) {
      if (this.password) {
        await this.authenticate(this.handle, this.password);
      } else {
        throw new Error('Password is required.');
      }
    }
  }

  public async handleToDid(handle: string): Promise<string> {
    const response = await this.makeRPCRequest({
      domain: 'https://bsky.social',
      endpoint: 'com.atproto.identity.resolveHandle',
      method: 'GET',
      queryParams: {
        handle,
      },
    });
    const { did } = response;

    if (!did) {
      throw new Error('Could not resolve handle to DID');
    }

    return did;
  }

  public static async didToPdsDomain(did: string): Promise<string> {
    const [, type] = did.split(':');

    try {
      if (type === 'plc') {
        const response = await fetch(`https://plc.directory/${did}`);
        const json: any = await response.json();
        const { service } = json;
        const pdsService = service.find(
          (service: any) => service.type === 'AtprotoPersonalDataServer'
        );
        return pdsService.serviceEndpoint;
      }

      // ???
      return '';
    } catch {
      throw new Error('Could not resolve DID to PDS domain');
    }
  }

  public async authenticate(handle: string, password: string): Promise<any> {
    const response = await this.makeRPCRequest({
      domain: 'https://bsky.social',
      endpoint: 'com.atproto.server.createSession',
      method: 'POST',
      params: {
        identifier: handle,
        password,
      },
    });

    this.setAccessToken(response.accessJwt);

    return response;
  }

  public async getFollowers({ limit }: { limit?: number }) {
    const followers = await this.getAllPages({
      endpoint: 'app.bsky.graph.getFollowers',
      resultKey: 'followers',
      queryParams: {
        actor: this.userDid,
      },
      limit,
    });

    return followers;
  }

  public async getFollows({ limit }: { limit?: number }) {
    const followers = await this.getAllPages({
      endpoint: 'app.bsky.graph.getFollows',
      resultKey: 'follows',
      queryParams: {
        actor: this.userDid,
      },
      limit,
    });

    return followers;
  }

  public async getRecord(repo: string, collection: string, rkey: string) {
    const response = await this.makeRPCRequest({
      endpoint: 'com.atproto.repo.getRecord',
      method: 'GET',
      queryParams: {
        repo,
        collection,
        rkey,
      },
    });

    return response;
  }

  public async getAllWithRecords(fn: string, parameters: any, recordKeyFn: Function) {
    // @ts-ignore
    const results = await this[fn](parameters);

    const resultsWithRecords = await Promise.all(
      results.map(async (result: any) => {
        const id = recordKeyFn(result).split('://').pop();
        const [repo, collection, rkey] = id.split('/');
        const record = await this.getRecord(repo, collection, rkey);
        return { result, record };
      })
    );

    return resultsWithRecords;
  }

  public async getLikes({ limit }: { limit?: number }) {
    const likes = await this.getAllPages({
      endpoint: 'app.bsky.feed.getActorLikes',
      resultKey: 'feed',
      queryParams: {
        actor: this.userDid,
      },
      limit,
    });

    return likes;
  }

  public async getAuthorFeed({ limit }: { limit?: number }) {
    const posts = await this.getAllPages({
      endpoint: 'app.bsky.feed.getAuthorFeed',
      resultKey: 'feed',
      queryParams: {
        actor: this.userDid,
      },
      limit,
    });

    return posts;
  }

  public async getProfile(handle: string) {
    const endpoint = 'app.bsky.actor.getProfile';

    const response = await this.makeRPCRequest({
      endpoint,
      method: 'GET',
      queryParams: {
        actor: handle,
      },
    });

    return response;
  }

  private async getAllPages(
    { endpoint, resultKey, queryParams, limit } = {} as {
      endpoint: string;
      limit?: number;
      queryParams?: any;
      resultKey: string;
    }
  ) {
    return this.paginateCursor<any>({
      limit,
      fetchPage: async cursor => {
        const response = await this.makeRPCRequest({
          endpoint,
          method: 'GET',
          queryParams: {
            ...queryParams,
            ...(cursor ? { cursor } : {}),
          },
        });
        return { items: response[resultKey], cursor: response.cursor };
      },
    });
  }

  private async makeRPCRequest({
    domain = this.pdsDomain,
    endpoint,
    method,
    params,
    queryParams,
  }: {
    domain?: string;
    endpoint: string;
    method: 'GET' | 'POST';
    params?: any;
    queryParams?: any;
  }): Promise<any> {
    return this.request<any>({
      url: `${domain}/xrpc/${endpoint}`,
      method,
      data: params,
      params: queryParams,
    });
  }
}
