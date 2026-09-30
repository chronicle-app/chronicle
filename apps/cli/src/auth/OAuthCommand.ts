import { PluginScanner } from '../plugins/PluginScanner.js';
import { Config } from '@oclif/core';
import { OAuthServer } from './OAuthServer.js';
import { OAuthProviderRegistry } from './ProviderRegistry.js';
import { BrowserLauncher } from './BrowserLauncher.js';
import { CredentialManager } from './CredentialManager.js';
import { OAuthParams, TokenResponse } from './types.js';
import { createLogger } from '@chronicle.app/logging';

const logger = createLogger({ scope: 'auth' });

export interface OAuthCommandOptions {
  clientId?: string;
  clientSecret?: string;
  port?: number;
  scopes?: string[];
  noBrowser?: boolean;
  timeout?: number;
}

export class OAuthCommand {
  private server: OAuthServer;
  private options: OAuthCommandOptions;
  private providerId: string;

  constructor(providerId: string, options: OAuthCommandOptions) {
    this.providerId = providerId;
    this.options = options;
    this.server = new OAuthServer();
  }

  /**
   * Execute the OAuth flow
   */
  async execute(): Promise<TokenResponse> {
    await OAuthCommand.listProviders();

    // Validate provider exists
    const ProviderClass = OAuthProviderRegistry.get(this.providerId);
    if (!ProviderClass) {
      throw new Error(
        `Unknown OAuth provider: ${this.providerId}. Available providers: ${OAuthProviderRegistry.getProviderIds().join(', ')}`
      );
    }

    const config = ProviderClass.getConfig();

    // Fall back to client credentials stored from a previous login, so
    // re-authenticating doesn't require re-passing --client-id/--client-secret.
    if (!this.options.clientId || (config.requiresClientSecret && !this.options.clientSecret)) {
      const stored = await CredentialManager.getCredentials(this.providerId);
      if (stored) {
        this.options.clientId ||= stored.clientId;
        this.options.clientSecret ||= stored.clientSecret;
      }
    }

    // Validate required options
    if (!this.options.clientId) {
      throw new Error(
        `Client ID is required. Pass --client-id, or run "chronicle auth login ${this.providerId}" once with --client-id (and --client-secret) to store them for reuse.`
      );
    }

    if (config.requiresClientSecret && !this.options.clientSecret) {
      throw new Error(
        `Client secret is required for this provider. Pass --client-secret, or run "chronicle auth login ${this.providerId}" once with it to store it for reuse.`
      );
    }

    const { server } = this;
    const onInterrupt = () =>
      server.stop(Object.assign(new Error('Authorization cancelled'), { exitCode: 130 }));
    // Start OAuth server
    const port = await this.server.start(
      this.options.port || 0,
      this.options.timeout === undefined ? undefined : this.options.timeout * 1000
    );
    process.once('SIGINT', onInterrupt);
    try {
      const callbackUrl = this.server.getCallbackUrl();

      logger.debug('OAuth server listening', { port });

      // Create provider instance
      const oauthParams: OAuthParams = {
        // Guaranteed present by the validation above.
        clientId: this.options.clientId!,
        clientSecret: this.options.clientSecret || '',
        redirectUri: callbackUrl,
        scopes: this.options.scopes || config.scopes,
      };

      const provider = new (ProviderClass as any)(oauthParams);
      const authUrl = provider.buildAuthUrl();

      // Open browser or provide manual URL
      // The URL is the one thing a person must act on, so it isn't cut to fit.
      const openManually = () => logger.info('Open this URL in your browser', { url: authUrl });
      if (this.options.noBrowser || !(await BrowserLauncher.canOpenBrowser())) {
        openManually();
      } else {
        try {
          await BrowserLauncher.openUrl(authUrl);
          logger.info('Opened the authorization page in your browser', { url: authUrl });
        } catch (error) {
          logger.warn("Couldn't open a browser", { error: String(error) });
          openManually();
        }
      }

      logger.info('Waiting for authorization…');

      // Wait for callback
      const result = await this.server.waitForCallback();

      if (result.error) {
        throw new Error(
          `Authorization failed: ${result.error}${result.error_description ? ` - ${result.error_description}` : ''}`
        );
      }

      const authCode = result.code || result.token;
      if (!authCode) {
        throw new Error('No authorization code or token received');
      }

      logger.debug('Authorization received; exchanging it for tokens');

      // Exchange code/token for tokens
      const tokens = await provider.exchangeCodeForToken(authCode);

      // Store credentials in local file for future use
      try {
        await CredentialManager.storeCredentials(
          this.providerId,
          tokens,
          this.options.clientId,
          this.options.clientSecret
        );
        const credentialsPath = CredentialManager.getCredentialsPath();
        logger.emit({
          level: 'info',
          kind: 'summary',
          message: `Signed in to ${this.providerId}`,
          fields: { credentials: credentialsPath },
        });
      } catch (error) {
        // Continue anyway - user still gets the tokens
        logger.warn("Signed in, but couldn't save the credentials", { error: String(error) });
      }

      return tokens;
    } finally {
      // Always cleanup
      this.server.stop();
      process.removeListener('SIGINT', onInterrupt);
    }
  }

  /**
   * List available providers
   */
  static async listProviders(providedConfig?: Config): Promise<string[]> {
    for (const plugin of await PluginScanner.findChroniclePlugins()) {
      await PluginScanner.importPlugin(plugin);
    }
    return OAuthProviderRegistry.getProviderIds();
  }

  /**
   * Check if a provider is available
   */
  static hasProvider(providerId: string): boolean {
    return OAuthProviderRegistry.has(providerId);
  }
}
