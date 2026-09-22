import React from 'react';
import { render, Box, Text } from 'ink';
import { getTheme, type ChronicleTheme } from '../theme.js';

interface CredentialInfo {
  provider: string;
  isValid: boolean;
  lastUsed?: Date;
  expiresAt?: Date;
}

interface InkCredentialsDisplayProps {
  credentials: CredentialInfo[];
  theme?: ChronicleTheme;
}

const formatDate = (date?: Date): string => {
  if (!date) return 'Unknown';
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

const InkCredentialsDisplayComponent: React.FC<InkCredentialsDisplayProps> = ({
  credentials,
  theme,
}) => {
  const currentTheme = theme || getTheme('default');

  const getStatusDisplay = (credential: CredentialInfo) => {
    if (credential.isValid) {
      return {
        icon: '✅',
        text: 'Valid',
        color: currentTheme.colors.success,
      };
    }
    return {
      icon: '⚠️',
      text: 'Expired/Invalid',
      color: currentTheme.colors.error,
    };
  };

  return (
    <Box flexDirection="column">
      {/* Title */}
      <Text color={currentTheme.colors.secondary} bold>
        Stored Credentials
      </Text>
      <Text color={currentTheme.colors.secondary}>{'='.repeat('Stored Credentials'.length)}</Text>
      <Text> </Text>

      {credentials.length === 0 ? (
        <Box flexDirection="column">
          <Text color={currentTheme.colors.textDim}>No stored credentials found.</Text>
          <Text color={currentTheme.colors.textDim}>Authenticate with providers using: </Text>
          <Text color={currentTheme.colors.primary} bold>
            chronicle auth {'<provider>'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* Header */}
          <Box>
            <Box width={20}>
              <Text color={currentTheme.colors.primary} bold>
                Provider
              </Text>
            </Box>
            <Box width={20}>
              <Text color={currentTheme.colors.primary} bold>
                Status
              </Text>
            </Box>
            <Box width={25}>
              <Text color={currentTheme.colors.primary} bold>
                Last Used
              </Text>
            </Box>
            <Box width={25}>
              <Text color={currentTheme.colors.primary} bold>
                Expires
              </Text>
            </Box>
          </Box>

          {/* Separator */}
          <Text color={currentTheme.colors.textDim}>
            {'─'.repeat(20)} {'─'.repeat(20)} {'─'.repeat(25)} {'─'.repeat(25)}
          </Text>

          {/* Credential rows */}
          {credentials.map(credential => {
            const status = getStatusDisplay(credential);

            return (
              <Box key={credential.provider}>
                <Box width={20}>
                  <Text color={currentTheme.colors.text}>{credential.provider}</Text>
                </Box>
                <Box width={20}>
                  <Text color={status.color}>
                    {status.icon} {status.text}
                  </Text>
                </Box>
                <Box width={25}>
                  <Text color={currentTheme.colors.textDim}>{formatDate(credential.lastUsed)}</Text>
                </Box>
                <Box width={25}>
                  <Text color={currentTheme.colors.textDim}>
                    {formatDate(credential.expiresAt)}
                  </Text>
                </Box>
              </Box>
            );
          })}

          <Text> </Text>

          {/* Summary */}
          <Box>
            <Text color={currentTheme.colors.textDim}>Total: </Text>
            <Text color={currentTheme.colors.text}>{credentials.length} provider(s) | </Text>
            <Text color={currentTheme.colors.success}>
              {credentials.filter(c => c.isValid).length} valid
            </Text>
            <Text color={currentTheme.colors.textDim}> | </Text>
            <Text color={currentTheme.colors.warning}>
              {credentials.filter(c => !c.isValid).length} expired
            </Text>
          </Box>

          <Text> </Text>

          {/* Actions */}
          <Text color={currentTheme.colors.textDim}>Actions:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text color={currentTheme.colors.textDim}>• Refresh credentials: </Text>
            <Text color={currentTheme.colors.primary}> chronicle auth {'<provider>'}</Text>
            <Text color={currentTheme.colors.textDim}>• Remove credentials: </Text>
            <Text color={currentTheme.colors.primary}>
              {' '}
              chronicle credentials --remove {'<provider>'}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export function renderInkCredentialsDisplay(
  credentials: CredentialInfo[],
  options: {
    theme?: string;
  } = {}
): void {
  const theme = getTheme(options.theme || 'default');

  const app = render(<InkCredentialsDisplayComponent credentials={credentials} theme={theme} />);

  // Auto-unmount after rendering (for CLI display)
  setTimeout(() => {
    app.unmount();
  }, 100);
}

export type { CredentialInfo };
