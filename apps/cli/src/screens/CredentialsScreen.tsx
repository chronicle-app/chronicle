import React from 'react';
import { Box, Text } from 'ink';
import { Table, type TableColumn } from '../components/Table.js';
import type { ChronicleTheme } from '../theme.js';

export interface CredentialInfo {
  provider: string;
  isValid: boolean;
  lastUsed?: Date;
  expiresAt?: Date;
}

interface CredentialsScreenProps {
  credentials: CredentialInfo[];
  theme: ChronicleTheme;
}

export const CredentialsScreen: React.FC<CredentialsScreenProps> = ({ credentials, theme }) => {
  const columns: TableColumn[] = [
    {
      key: 'provider',
      title: 'Provider',
      width: 15,
    },
    {
      key: 'status',
      title: 'Status',
      width: 15,
      render: (_, row: CredentialInfo) => (
        <Text color={row.isValid ? theme.colors.success : theme.colors.error}>
          {row.isValid ? '✅ Valid' : '⚠️ Expired'}
        </Text>
      ),
    },
    {
      key: 'lastUsed',
      title: 'Last Used',
      width: 20,
      render: (value: Date | undefined) => (
        <Text color={theme.colors.textDim}>{value ? value.toLocaleDateString() : 'Unknown'}</Text>
      ),
    },
    {
      key: 'expiresAt',
      title: 'Expires',
      width: 20,
      render: (value: Date | undefined) => (
        <Text color={theme.colors.textDim}>{value ? value.toLocaleDateString() : 'Unknown'}</Text>
      ),
    },
  ];

  const validCount = credentials.filter(c => c.isValid).length;
  const expiredCount = credentials.length - validCount;

  return (
    <Box flexDirection="column">
      <Table
        title="Stored Credentials"
        columns={columns}
        data={credentials}
        theme={theme}
        emptyMessage="No stored credentials found."
      />

      {credentials.length > 0 && (
        <>
          <Text> </Text>
          <Box>
            <Text color={theme.colors.textDim}>Total: </Text>
            <Text>{credentials.length} provider(s) | </Text>
            <Text color={theme.colors.success}>{validCount} valid</Text>
            <Text color={theme.colors.textDim}> | </Text>
            <Text color={theme.colors.warning}>{expiredCount} expired</Text>
          </Box>
        </>
      )}

      <Text> </Text>
      <Text color={theme.colors.textDim} bold>
        Actions:
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text color={theme.colors.textDim}>• Refresh credentials: </Text>
        <Text color={theme.colors.primary}> chronicle auth {'<provider>'}</Text>
        <Text color={theme.colors.textDim}>• Remove credentials: </Text>
        <Text color={theme.colors.primary}> chronicle credentials --remove {'<provider>'}</Text>
      </Box>
    </Box>
  );
};
