import { AuthRequired } from '@chronicle.app/logging';
import { CredentialManager } from './CredentialManager.js';
import { OAuthProviderRegistry } from './ProviderRegistry.js';

export const TokenHelper = {
  /**
   * A valid access token for a provider, with user-friendly error messages.
   * `refresh` gets a new one even when the stored one looks current: the
   * source refused it.
   */
  async getValidToken(
    provider: string,
    { account, refresh }: { account?: string; refresh?: boolean } = {}
  ): Promise<string> {
    const token = await CredentialManager.getValidToken(provider, { account, refresh });

    if (!token) {
      const stored = await CredentialManager.getCredentials(provider, { account });
      // A client stored from an earlier sign-in is reused, and a provider
      // with guided setup makes one, so the command needs no client flags then.
      const login =
        stored?.clientId || OAuthProviderRegistry.get(provider)?.setup
          ? `chronicle auth login ${provider}`
          : `chronicle auth login ${provider} --client-id <id> --client-secret <secret>`;

      if (stored) {
        throw new AuthRequired(`${provider} credentials expired and couldn't be refreshed`, {
          hint: `Run \`${login}\` to sign in again.`,
        });
      }
      if (account && (await CredentialManager.hasCredentials(provider))) {
        throw new AuthRequired(`No ${provider} credentials for that account`, {
          hint: `Run \`chronicle auth login ${provider}\` and sign in with that account.`,
          fields: { account },
        });
      }
      throw new AuthRequired(`No ${provider} credentials`, {
        hint: `Run \`${login}\` to sign in.`,
      });
    }

    return token;
  },

  /**
   * Get token or use provided access token, with preference for keychain
   */
  async getTokenWithFallback(provider: string, providedToken?: string): Promise<string> {
    // If user provided a token explicitly, use it
    if (providedToken) {
      return providedToken;
    }

    // Otherwise try to get from keychain
    return this.getValidToken(provider);
  },

  /**
   * Check if valid credentials exist for a provider
   */
  async hasValidCredentials(
    provider: string,
    options: { account?: string } = {}
  ): Promise<boolean> {
    try {
      const token = await CredentialManager.getValidToken(provider, options);
      return token !== null;
    } catch {
      return false;
    }
  },

  /**
   * Remove stored credentials (for logout/reset)
   */
  async removeCredentials(provider: string): Promise<void> {
    await CredentialManager.removeCredentials(provider);
  },

  /**
   * List providers with stored credentials
   */
  async listProvidersWithCredentials(): Promise<string[]> {
    return CredentialManager.listProviders();
  },
};
