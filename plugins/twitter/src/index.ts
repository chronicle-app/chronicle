export { TwitterArchiveExtractor } from './connectors/archive/TwitterArchiveExtractor.js';
export { TwitterArchiveTweetsExtractor } from './connectors/archive/TwitterArchiveTweetsExtractor.js';
export { TwitterArchiveLikesExtractor } from './connectors/archive/TwitterArchiveLikesExtractor.js';
export { TwitterArchiveDirectMessagesExtractor } from './connectors/archive/TwitterArchiveDirectMessagesExtractor.js';
export { default as TwitterTransformer } from './connectors/TwitterTransformer.js';
export { TwitterApiTweetsExtractor } from './connectors/api/TwitterApiTweetsExtractor.js';
export { TwitterApiLikesExtractor } from './connectors/api/TwitterApiLikesExtractor.js';
export { TwitterApiBookmarksExtractor } from './connectors/api/TwitterApiBookmarksExtractor.js';
export { TwitterApiMentionsExtractor } from './connectors/api/TwitterApiMentionsExtractor.js';
export { TwitterOAuthProvider } from './auth/TwitterOAuthProvider.js';

// Register OAuth provider
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { TwitterOAuthProvider } from './auth/TwitterOAuthProvider.js';

OAuthProviderRegistry.register(TwitterOAuthProvider);
