// Registers the Google sign-in, so `chronicle auth login google` finds it.
import '@chronicle.app/google';

// Export extractors for plugin scanning
export { GoogleCalendarEventsExtractor } from './connectors/GoogleCalendarEventsExtractor.js';
export { default as GoogleCalendarTransformer } from './connectors/GoogleCalendarTransformer.js';
