import axios from 'axios';
import { OAuthParams, TokenResponse, OAuthConfig } from './types.js';

/**
 * Base OAuth2 authorization-code flow. A standard provider only declares the
 * endpoints, scopes, and credential style:
 *
 *   class MyProvider extends OAuthProvider {
 *     static override providerId = 'my-source';
 *     static override authorizationUrl = 'https://example.com/authorize';
 *     static override tokenUrl = 'https://example.com/token';
 *     static override scopes = ['read'];
 *     static override tokenAuthStyle = 'basic-header';   // or 'body' (default)
 *     static override extraAuthParams = { access_type: 'offline' };
 *   }
 *
 * A provider whose protocol deviates from OAuth2 (e.g. Last.fm's signed
 * auth.getSession) overrides buildAuthUrl / exchangeCodeForToken instead.
 */
export abstract class OAuthProvider {
  static providerId: string;
  static authorizationUrl: string;
  static tokenUrl: string;
  static scopes: string[] = [];
  static requiresClientSecret: boolean = true;
  /**
   * Where the client credentials go on the token exchange: 'basic-header'
   * sends an Authorization: Basic header; 'body' (default) puts
   * client_id/client_secret in the form body.
   */
  static tokenAuthStyle: 'basic-header' | 'body' = 'body';
  /** Provider-specific additions to the authorization URL. */
  static extraAuthParams: Record<string, string> = {};

  protected params: OAuthParams;

  constructor(params: OAuthParams) {
    this.params = params;
  }

  static getConfig(): OAuthConfig {
    return {
      providerId: this.providerId,
      authorizationUrl: this.authorizationUrl,
      tokenUrl: this.tokenUrl,
      scopes: this.scopes,
      requiresClientSecret: this.requiresClientSecret,
    };
  }

  private get providerClass(): typeof OAuthProvider {
    return this.constructor as typeof OAuthProvider;
  }

  /**
   * Build the authorization URL where the user will be redirected
   */
  buildAuthUrl(): string {
    const cls = this.providerClass;
    const params: Record<string, string> = {
      client_id: this.params.clientId,
      response_type: 'code',
      redirect_uri: this.params.redirectUri,
    };

    const scope = (this.params.scopes?.length ? this.params.scopes : cls.scopes).join(' ');
    if (scope) {
      params.scope = scope;
    }

    Object.assign(params, cls.extraAuthParams);

    if (this.params.state) {
      params.state = this.params.state;
    }

    return `${cls.authorizationUrl}?${this.buildQueryString(params)}`;
  }

  /**
   * Exchange authorization code for access tokens
   */
  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    const cls = this.providerClass;
    try {
      const data = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.params.redirectUri,
      });
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      };

      if (cls.tokenAuthStyle === 'basic-header') {
        const credentials = Buffer.from(
          `${this.params.clientId}:${this.params.clientSecret}`
        ).toString('base64');
        headers.Authorization = `Basic ${credentials}`;
      } else {
        data.set('client_id', this.params.clientId);
        data.set('client_secret', this.params.clientSecret);
      }

      const response = await this.postToken(cls.tokenUrl, data, { headers });

      return {
        provider: cls.providerId,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        // Some providers (foursquare) omit token_type on the exchange
        token_type: response.token_type ?? 'Bearer',
        expires_in: response.expires_in,
        scope: response.scope,
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message =
          error.response?.data?.error_description || error.response?.data?.error || error.message;
        throw new Error(`Failed to exchange code for tokens: ${message}`);
      }
      throw error;
    }
  }

  /** One POST to the token endpoint; overridable so tests can mock HTTP. */
  protected async postToken(
    url: string,
    data: URLSearchParams,
    config: { headers: Record<string, string> }
  ): Promise<any> {
    const response = await axios.post(url, data, config);
    return response.data;
  }

  /**
   * Generate a random state parameter for CSRF protection
   */
  protected generateState(): string {
    return Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);
  }

  /**
   * Build query string from parameters
   */
  protected buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  }
}
