export interface OAuthParams {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  state?: string;
}

export interface TokenResponse {
  provider: string;
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  created_at: string;
  // Account username stored alongside the token, for sources whose API needs it
  // (e.g. Last.fm's `user` param). Persisted via the credential passthrough.
  username?: string;
}

export interface OAuthConfig {
  providerId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  requiresClientSecret: boolean;
}

export interface AuthorizationResult {
  code?: string;
  token?: string; // Last.fm uses token instead of code
  state?: string;
  error?: string;
  error_description?: string;
}
