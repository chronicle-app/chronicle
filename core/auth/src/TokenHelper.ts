import { CredentialManager } from './CredentialManager.js';

export const TokenHelper = {
  /**
   * Get a valid access token for a provider, with user-friendly error messages
   */
  async getValidToken(provider: string): Promise<string> {
    const token = await CredentialManager.getValidToken(provider);

    if (!token) {
      const hasCredentials = await CredentialManager.hasCredentials(provider);

      if (hasCredentials) {
        throw new Error(
          `${provider} credentials are expired and could not be refreshed. Please re-authenticate:\n` +
            `  chronicle auth ${provider} --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET`
        );
      } else {
        throw new Error(
          `No ${provider} credentials found. Please authenticate first:\n` +
            `  chronicle auth ${provider} --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET`
        );
      }
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
  async hasValidCredentials(provider: string): Promise<boolean> {
    try {
      const token = await CredentialManager.getValidToken(provider);
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
