export { default as ArenaExtractor } from './connectors/ArenaExtractor.js';
export { default as ArenaFollowingExtractor } from './connectors/ArenaFollowingExtractor.js';
export { default as ArenaBookmarksExtractor } from './connectors/ArenaBookmarksExtractor.js';
export { default as ArenaTransformer } from './connectors/ArenaTransformer.js';
export { ArenaOAuthProvider } from './auth/ArenaOAuthProvider.js';

// Register OAuth provider
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { ArenaOAuthProvider } from './auth/ArenaOAuthProvider.js';

OAuthProviderRegistry.register(ArenaOAuthProvider);
