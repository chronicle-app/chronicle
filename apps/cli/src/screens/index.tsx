import React from 'react';
import { render, Box } from 'ink';
import { ThemeProvider } from '@inkjs/ui';
import { getTheme } from '../theme.js';
import { CredentialsScreen, type CredentialInfo } from './CredentialsScreen.js';
import { ConfigScreen } from './ConfigScreen.js';
import { SourcesScreen } from './SourcesScreen.js';
import type { SourceListing } from '../plugins/catalog.js';

// Screen components
export { CredentialsScreen, type CredentialInfo } from './CredentialsScreen.js';
export { ConfigScreen } from './ConfigScreen.js';
export { SourcesScreen } from './SourcesScreen.js';
export { Table, type TableColumn, type TableRow } from '../components/Table.js';

// Screen render functions
export function renderCredentialsScreen(
  credentials: CredentialInfo[],
  options: { theme?: string } = {}
): void {
  const theme = getTheme(options.theme || 'default');
  renderScreen(<CredentialsScreen credentials={credentials} theme={theme} />, options);
}

export function renderConfigScreen(
  config: any,
  configPath: string,
  options: { theme?: string } = {}
): void {
  const theme = getTheme(options.theme || 'default');
  renderScreen(<ConfigScreen config={config} configPath={configPath} theme={theme} />, options);
}

export function renderSourcesScreen(
  sources: SourceListing[],
  options: { theme?: string } = {}
): Promise<void> {
  const theme = getTheme(options.theme || 'default');
  return renderScreen(<SourcesScreen sources={sources} theme={theme} />, options);
}

// Utility function to render any screen with theme. Resolves once the screen
// has unmounted, so a caller can print further output below it.
export function renderScreen(
  component: React.ReactElement,
  options: {
    theme?: string;
  } = {}
): Promise<void> {
  const theme = getTheme(options.theme || 'default');

  const app = render(
    <ThemeProvider theme={theme.inkTheme}>
      <Box padding={1}>{component}</Box>
    </ThemeProvider>
  );

  // Auto-unmount after rendering (for CLI display)
  setTimeout(() => {
    app.unmount();
  }, 100);
  return app.waitUntilExit();
}
