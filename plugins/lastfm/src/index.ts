export { LastfmRecentTracksExtractor } from './connectors/LastfmRecentTracksExtractor.js';
export { LastfmLovedTracksExtractor } from './connectors/LastfmLovedTracksExtractor.js';
export { LastfmFriendsExtractor } from './connectors/LastfmFriendsExtractor.js';
export { default as LastfmTransformer } from './connectors/LastfmTransformer.js';

// Register OAuth provider
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { LastfmOAuthProvider } from './auth/LastfmOAuthProvider.js';

OAuthProviderRegistry.register(LastfmOAuthProvider);
