import React from 'react';
import { Box, Text } from 'ink';
import { Table, type TableColumn } from '../components/Table.js';
import type { ChronicleTheme } from '../theme.js';

export interface ExtractorInfo {
  source: string;
  strategy: string;
  delivery: string;
  recordType: string | string[];
  description?: string;
  packageName?: string;
  default?: boolean;
}

interface ExtractorsScreenProps {
  extractors: ExtractorInfo[];
  theme: ChronicleTheme;
}

export const ExtractorsScreen: React.FC<ExtractorsScreenProps> = ({ extractors, theme }) => {
  const columns: TableColumn[] = [
    {
      key: 'source',
      title: 'Source',
      width: 18,
      render: (value: string) => <Text color={theme.colors.primary}>{value}</Text>,
    },
    {
      key: 'strategy',
      title: 'Via',
      width: 12,
    },
    {
      key: 'default',
      title: 'Default',
      width: 8,
      render: (value: boolean) => (
        <Text color={value ? theme.colors.success : theme.colors.textDim}>{value ? '✓' : ''}</Text>
      ),
    },
    {
      key: 'delivery',
      title: 'Delivery',
      width: 8,
      render: (value: string) => <Text color={theme.colors.textDim}>{value}</Text>,
    },
    {
      key: 'recordTypes',
      title: 'Record Types',
      width: 18,
      render(_, row: ExtractorInfo) {
        const recordTypes = Array.isArray(row.recordType)
          ? row.recordType.join(', ')
          : row.recordType || '';

        // Truncate if too long
        const maxLength = 16;
        const truncated =
          recordTypes.length > maxLength
            ? recordTypes.slice(0, Math.max(0, maxLength - 1)) + '…'
            : recordTypes;

        return <Text color={theme.colors.textDim}>{truncated}</Text>;
      },
    },
    {
      key: 'description',
      title: 'Description',
      width: 40,
      render(value: string = '') {
        // Truncate if too long
        const maxLength = 38;
        const truncated =
          value.length > maxLength ? value.slice(0, Math.max(0, maxLength - 1)) + '…' : value;

        return <Text>{truncated}</Text>;
      },
    },
  ];

  const sourceCount = new Set(extractors.map(e => e.source)).size;

  return (
    <Box flexDirection="column">
      <Table
        title="Available Extractors"
        columns={columns}
        data={extractors}
        theme={theme}
        emptyMessage="No extractors found matching the specified criteria."
      />

      {extractors.length > 0 && (
        <>
          <Text> </Text>
          <Box>
            <Text color={theme.colors.textDim}>Found </Text>
            <Text>{extractors.length}</Text>
            <Text color={theme.colors.textDim}> extractors across </Text>
            <Text>{sourceCount}</Text>
            <Text color={theme.colors.textDim}> sources. Usage: </Text>
            <Text color={theme.colors.primary}>chronicle import {'<SOURCE>'}</Text>
            <Text color={theme.colors.textDim}> or </Text>
            <Text color={theme.colors.primary}>
              chronicle import {'<SOURCE>'} --via {'<VIA>'} -t {'<TYPE>'}
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
};
