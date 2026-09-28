export { FoursquareExtractor } from './connectors/FoursquareExtractor.js';
export { default as FoursquareTransformer } from './connectors/FoursquareTransformer.js';
export { FoursquareOAuthProvider } from './auth/FoursquareOAuthProvider.js';

// Register OAuth provider
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { FoursquareOAuthProvider } from './auth/FoursquareOAuthProvider.js';

OAuthProviderRegistry.register(FoursquareOAuthProvider);
