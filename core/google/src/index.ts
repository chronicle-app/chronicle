import { OAuthProviderRegistry } from '@chronicle.app/auth';
import { GoogleOAuthProvider } from './GoogleOAuthProvider.js';

// Every Google source imports this package, so `chronicle auth login google`
// finds the provider once any of them is installed.
OAuthProviderRegistry.register(GoogleOAuthProvider);

export { GoogleOAuthProvider } from './GoogleOAuthProvider.js';
export { GoogleApi, googleAccountOptions, type GoogleApiOptions } from './GoogleApi.js';
export { googleAccount } from './account.js';
export { GOOGLE_SERVICES, isGoogleService, type GoogleService } from './services.js';
export { setupGoogleClient, type SetupOptions } from './setup.js';
export { CommandLineGcloud, GcloudError, type Gcloud } from './gcloud.js';
export {
  ContactDirectory,
  contactIdentities,
  contactOptions,
  type ContactLinks,
} from './contacts.js';
