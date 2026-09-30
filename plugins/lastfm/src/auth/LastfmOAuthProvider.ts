import axios from 'axios';
import { createHash } from 'node:crypto';
import { OAuthProvider, TokenResponse } from '@chronicle.app/auth';
import { AuthRequired } from '@chronicle.app/etl';

export class LastfmOAuthProvider extends OAuthProvider {
  static override providerId = 'lastfm';
  static override authorizationUrl = 'https://www.last.fm/api/auth';
  static override tokenUrl = 'https://ws.audioscrobbler.com/2.0/';
  static override scopes: string[] = []; // Last.fm doesn't use scopes
  static override requiresClientSecret = true;

  /**
   * Build the authorization URL for Last.fm
   * https://www.last.fm/api/authentication
   */
  override buildAuthUrl(): string {
    const params = {
      api_key: this.params.clientId,
      cb: this.params.redirectUri,
    };

    const queryString = this.buildQueryString(params);
    return `${LastfmOAuthProvider.authorizationUrl}?${queryString}`;
  }

  /**
   * Exchange authorization token for session key
   * Last.fm uses a different flow than standard OAuth2
   */
  override async exchangeCodeForToken(token: string): Promise<TokenResponse> {
    try {
      // Step 1: Get session key using auth.getSession
      const paramsForSignature = {
        method: 'auth.getSession',
        api_key: this.params.clientId,
        token,
      };

      // Add API signature required by Last.fm
      const signature = this.generateApiSignature(paramsForSignature, this.params.clientSecret);

      const allParams = {
        ...paramsForSignature,
        format: 'json',
        api_sig: signature,
      };

      const sessionResponse = await axios.get(LastfmOAuthProvider.tokenUrl, {
        params: allParams,
      });

      const sessionData = sessionResponse.data;

      if (sessionData.error) {
        throw new AuthRequired(
          `Last.fm refused the session: ${sessionData.message || sessionData.error}`,
          {
            source: 'lastfm',
          }
        );
      }

      if (!sessionData.session || !sessionData.session.key) {
        throw new AuthRequired('Last.fm sent no session key', { source: 'lastfm' });
      }

      // Last.fm returns a session key instead of access/refresh tokens
      const tokens: TokenResponse = {
        provider: 'lastfm',
        access_token: sessionData.session.key,
        token_type: 'session',
        created_at: new Date().toISOString(),
        // Store the username from the session data
        username: sessionData.session.name,
      } as any;

      return tokens;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.message || error.message;
        throw new AuthRequired(`Couldn't get a Last.fm session: ${message}`, {
          source: 'lastfm',
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Generate API signature required by Last.fm
   * Based on working omniauth-lastfm implementation
   */
  private generateApiSignature(params: Record<string, string>, secret: string): string {
    // Last.fm signature for auth.getSession: api_key{api_key}methodauth.getSessiontoken{token}{secret}
    const signatureString = `api_key${params.api_key}method${params.method}token${params.token}${secret}`;
    return createHash('md5').update(signatureString, 'utf8').digest('hex');
  }
}
