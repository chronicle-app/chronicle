// Export extractors
export { SpotifyBaseExtractor } from './connectors/SpotifyBaseExtractor.js';
export { SpotifyRecentlyPlayedExtractor } from './connectors/SpotifyRecentlyPlayedExtractor.js';
export { SpotifySavedTracksExtractor } from './connectors/SpotifySavedTracksExtractor.js';
export { SpotifySavedAlbumsExtractor } from './connectors/SpotifySavedAlbumsExtractor.js';
export { SpotifyPlaylistsExtractor } from './connectors/SpotifyPlaylistsExtractor.js';
export { default as SpotifyTransformer } from './connectors/SpotifyTransformer.js';
export { SpotifyArchiveExtractor } from './connectors/archive/SpotifyArchiveExtractor.js';
export { SpotifyArchiveListensExtractor } from './connectors/archive/SpotifyArchiveListensExtractor.js';
export { SpotifyArchiveLibraryExtractor } from './connectors/archive/SpotifyArchiveLibraryExtractor.js';
export { SpotifyArchivePlaylistsExtractor } from './connectors/archive/SpotifyArchivePlaylistsExtractor.js';
export { SpotifyArchiveSearchesExtractor } from './connectors/archive/SpotifyArchiveSearchesExtractor.js';
export { default as SpotifyArchiveTransformer } from './connectors/archive/SpotifyArchiveTransformer.js';

// Register OAuth provider
import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { SpotifyOAuthProvider } from './auth/SpotifyOAuthProvider.js';

OAuthProviderRegistry.register(SpotifyOAuthProvider);
