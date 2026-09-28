import React from 'react';
import { Box, Text, useStdout } from 'ink';
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
  // The screen is padded by one column on each side.
  const { stdout } = useStdout();
  const width = (stdout.columns || 80) - 2;

  const columns: TableColumn[] = [
    {
      key: 'source',
      title: 'Source',
      render: (_, __, text) => <Text color={theme.colors.primary}>{text}</Text>,
    },
    {
      key: 'strategy',
      title: 'Via',
    },
    {
      key: 'default',
      title: 'Default',
      text: (row: ExtractorInfo) => (row.default ? '✓' : ''),
      render: (value: boolean, _, text) => (
        <Text color={value ? theme.colors.success : theme.colors.textDim}>{text}</Text>
      ),
    },
    {
      key: 'delivery',
      title: 'Delivery',
      render: (_, __, text) => <Text color={theme.colors.textDim}>{text}</Text>,
    },
    {
      key: 'recordTypes',
      title: 'Record Types',
      grow: true,
      minWidth: 12,
      text: (row: ExtractorInfo) =>
        Array.isArray(row.recordType) ? row.recordType.join(', ') : row.recordType || '',
      render: (_, __, text) => <Text color={theme.colors.textDim}>{text}</Text>,
    },
    {
      key: 'description',
      title: 'Description',
      grow: true,
      minWidth: 16,
      text: (row: ExtractorInfo) => row.description ?? '',
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
        width={width}
      />

      {extractors.length > 0 && (
        <>
          <Text> </Text>
          <Text color={theme.colors.textDim}>
            Found <Text color={theme.colors.text}>{extractors.length}</Text> extractors across{' '}
            <Text color={theme.colors.text}>{sourceCount}</Text> sources.
          </Text>
          <Text color={theme.colors.textDim}>
            Usage: <Text color={theme.colors.primary}>chronicle extract {'<SOURCE>'}</Text> or{' '}
            <Text color={theme.colors.primary}>
              chronicle extract {'<SOURCE>'} --via {'<VIA>'} -t {'<TYPE>'}
            </Text>
          </Text>
        </>
      )}
    </Box>
  );
};
