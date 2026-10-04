// Registers the Google sign-in, so `chronicle auth login google` finds it.
import '@chronicle.app/google';

// Export extractors for plugin scanning
export { GmailApiExtractor } from './connectors/GmailApiExtractor.js';
export { GmailTakeoutExtractor } from './connectors/GmailTakeoutExtractor.js';
export { default as GmailTransformer } from './connectors/GmailTransformer.js';
