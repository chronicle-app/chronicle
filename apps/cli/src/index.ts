export { default as ExtractCommand } from './ExtractCommand.js';

export { run } from '@oclif/core';

// UI Components for external tools
export { InkPicker, picker, inkInput, inkSelect } from './components/InkPicker.js';
export type {
  PickerStep,
  PickerConfig,
  PickerResult,
  SelectOption,
  InkInputResult,
  InkSelectResult,
} from './components/InkPicker.js';

// OAuth exports for plugins
export {
  OAuthProvider,
  OAuthProviderRegistry,
  OAuthServer,
  OAuthCommand,
  BrowserLauncher,
  CredentialManager,
  TokenHelper,
  resolveCredentials,
} from './auth/index.js';
export type { OAuthParams, TokenResponse, OAuthConfig, AuthorizationResult } from './auth/index.js';

// Config exports for tools that run outside an oclif command and read
// `chronicle config` values from the same file.
export { ConfigManager, chronicleConfigDir } from './config/index.js';
