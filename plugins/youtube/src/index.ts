export { YouTubeBaseExtractor } from './connectors/YouTubeBaseExtractor.js';
export { YouTubeLikesExtractor } from './connectors/YouTubeLikesExtractor.js';
export { YouTubeSubscriptionsExtractor } from './connectors/YouTubeSubscriptionsExtractor.js';
export { YouTubePlaylistsExtractor } from './connectors/YouTubePlaylistsExtractor.js';
export { YouTubeUploadsExtractor } from './connectors/YouTubeUploadsExtractor.js';
export { YouTubeTakeoutExtractor } from './connectors/YouTubeTakeoutExtractor.js';
export { default as YouTubeTransformer } from './connectors/YouTubeTransformer.js';
export { default as YouTubeTakeoutTransformer } from './connectors/YouTubeTakeoutTransformer.js';

// Register OAuth provider
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { GoogleOAuthProvider } from './auth/GoogleOAuthProvider.js';

OAuthProviderRegistry.register(GoogleOAuthProvider);
