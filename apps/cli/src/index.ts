export { default as ExtractCommand } from './ExtractCommand.js';

export { run } from '@oclif/core';

// Questions to ask at a terminal, for external tools
export { confirm, select, multiSelect, input } from './output/prompts.js';
export type {
  SelectOption,
  ConfirmResult,
  SelectResult,
  MultiSelectResult,
  InputResult,
} from './output/prompts.js';

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
