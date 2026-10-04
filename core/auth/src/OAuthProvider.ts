import axios from 'axios';
import { EXIT_CODES, ExtractorError } from '@chronicle.app/logging';
import { createHash, randomBytes } from 'node:crypto';
import {
  ClientCredentials,
  OAuthParams,
  OAuthConfig,
  ProviderSetupContext,
  TokenResponse,
} from './types.js';

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
 *
 * A provider whose people register their own OAuth client can walk them
 * through it in `setup()`, which `chronicle auth login` runs when no client
 * is given on the command line.
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
  /** Send a PKCE challenge with the authorization and its verifier with the exchange. */
  static pkce: boolean = false;
  /**
   * Scopes by a name a person can pass to `chronicle auth login --add`, for
   * a provider whose sources each need their own (`gmail`, `calendar`).
   * Every login also asks for `scopes`.
   */
  static scopeSets: Record<string, string[]> = {};
  /** The sets a first login asks for when none are named. */
  static defaultScopeSets: string[] = [];
  /** Printed under the sign-in summary: what to run next. */
  static signedInHint?: string;
  /**
   * Find or make the OAuth client to sign in with, walking the person
   * through whatever the provider's console needs. Run by `chronicle auth
   * login` when no `--client-id` is given.
   */
  static setup?(context: ProviderSetupContext): Promise<ClientCredentials>;

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

  /** The scopes for the named sets, with the provider's own, without repeats. */
  static scopesFor(sets: string[]): string[] {
    const unknown = sets.filter(set => !this.scopeSets[set]);
    if (unknown.length > 0) {
      const known = Object.keys(this.scopeSets);
      throw new ExtractorError(`Unknown access "${unknown[0]}" for ${this.providerId}`, {
        code: 'unknown-scope-set',
        exitCode: EXIT_CODES.usage,
        hint: `Use ${known.length > 1 ? `${known.slice(0, -1).join(', ')}, or ${known.at(-1)}` : known[0]}.`,
      });
    }
    return [...new Set([...this.scopes, ...sets.flatMap(set => this.scopeSets[set])])];
  }

  /** The named sets a granted scope string covers in full. */
  static scopeSetsIn(granted: string | undefined): string[] {
    const have = new Set((granted ?? '').split(/\s+/).filter(Boolean));
    return Object.entries(this.scopeSets)
      .filter(([, scopes]) => scopes.every(scope => have.has(scope)))
      .map(([set]) => set);
  }

  /** A PKCE verifier: 43 URL-safe characters. */
  static createCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Which account signed in, from the token response, for a provider that
   * says (an OpenID `id_token`). Several accounts of one provider are kept
   * apart by it.
   */
  protected accountFrom(_response: any): string | undefined {
    return undefined;
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

    if (cls.pkce && this.params.codeVerifier) {
      params.code_challenge = createHash('sha256')
        .update(this.params.codeVerifier)
        .digest('base64url');
      params.code_challenge_method = 'S256';
    }

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
      if (cls.pkce && this.params.codeVerifier) {
        data.set('code_verifier', this.params.codeVerifier);
      }
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
      const account = this.accountFrom(response);

      return {
        provider: cls.providerId,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        // Some providers (foursquare) omit token_type on the exchange
        token_type: response.token_type ?? 'Bearer',
        expires_in: response.expires_in,
        scope: response.scope,
        created_at: new Date().toISOString(),
        ...(account && { account }),
        tokenUrl: cls.tokenUrl,
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
  static generateState(): string {
    return randomBytes(16).toString('base64url');
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
