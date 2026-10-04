import type { Logger } from '@chronicle.app/logging';

export interface OAuthParams {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  state?: string;
  /** PKCE verifier, when the provider uses PKCE; its challenge goes in the auth URL. */
  codeVerifier?: string;
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
  /** Which of the provider's accounts signed in (an email), when it says. */
  account?: string;
  /** Where the refresh token is exchanged, saved so refresh needs no provider table. */
  tokenUrl?: string;
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

/** An OAuth client a person registered with the provider. */
export interface ClientCredentials {
  clientId: string;
  clientSecret?: string;
}

/**
 * What the CLI hands a provider's `setup()`: ways to talk to the person
 * without the provider depending on the CLI.
 */
export interface ProviderSetupContext {
  /** The command's logger; hints and notices go through it. */
  logger: Logger;
  /** Chronicle's config directory, for state the setup keeps between runs. */
  configDir: string;
  /** Named scope sets this login asks for (`--add`), so setup can enable their APIs. */
  scopeSets: string[];
  /** Whether a person is at a terminal to answer. */
  interactive: boolean;
  /** Start over instead of reusing what a previous setup made. */
  fresh: boolean;
  /** Open a page in the browser; with `--no-browser` it only prints the URL. */
  openUrl(url: string): Promise<void>;
  /**
   * Ask the person something and return what they typed (empty for just
   * Enter). Aborting `signal` withdraws the question.
   */
  ask(prompt: string, signal?: AbortSignal): Promise<string>;
  /** Cancelled with Ctrl-C. */
  signal: AbortSignal;
}
