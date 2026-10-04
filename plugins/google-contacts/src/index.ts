// Registers the Google sign-in, so `chronicle auth login google` finds it.
import '@chronicle.app/google';

// Export extractors for plugin scanning
export { GoogleContactsExtractor } from './connectors/GoogleContactsExtractor.js';
export { default as GoogleContactsTransformer } from './connectors/GoogleContactsTransformer.js';
