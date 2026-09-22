// Export all OAuth-related classes for use by plugins
export { OAuthProvider } from './OAuthProvider.js';
export { OAuthProviderRegistry } from './ProviderRegistry.js';
export { OAuthServer } from './OAuthServer.js';
export { OAuthCommand } from './OAuthCommand.js';
export { BrowserLauncher } from './BrowserLauncher.js';
export { CredentialManager } from './CredentialManager.js';
export { TokenHelper } from './TokenHelper.js';
export {
  resolveCredentials,
  pickCredentialFields,
  type CredentialFieldSpec,
  type ResolveCredentialsOptions,
} from './resolveCredentials.js';

// Export types
export type { OAuthParams, TokenResponse, OAuthConfig, AuthorizationResult } from './types.js';
