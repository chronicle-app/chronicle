import { OAuthProvider } from './OAuthProvider.js';

export class OAuthProviderRegistry {
  private static providers = new Map<string, typeof OAuthProvider>();

  /**
   * Register an OAuth provider
   */
  static register(provider: typeof OAuthProvider): void {
    if (!provider.providerId) {
      throw new Error(`Provider must have a providerId: ${provider.name}`);
    }
    this.providers.set(provider.providerId, provider);
  }

  /**
   * Get a provider by ID
   */
  static get(providerId: string): typeof OAuthProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all registered provider IDs
   */
  static getProviderIds(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Check if a provider is registered
   */
  static has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get all providers
   */
  static getAll(): Map<string, typeof OAuthProvider> {
    return new Map(this.providers);
  }
}
