import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { Table, type TableColumn } from '../components/Table.js';
import type { SourceListing } from '../plugins/catalog.js';
import type { ChronicleTheme } from '../theme.js';

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
};

/** Whether the source can run here, and if not, why. Legacy sources say so. */
export function statusOf(row: SourceListing): string {
  const status = availabilityOf(row);
  return row.tier === 'legacy' ? `legacy, ${status}` : status;
}

function availabilityOf(row: SourceListing): string {
  if (!row.installed) return 'not installed';
  if (!row.supported) {
    return `${row.platforms.map(p => PLATFORM_NAMES[p] ?? p).join(', ')} only`;
  }
  if (row.origin === 'local') return 'local';
  if (!row.tier) return 'not in catalog';
  return 'installed';
}

interface SourcesScreenProps {
  sources: SourceListing[];
  theme: ChronicleTheme;
}

export const SourcesScreen: React.FC<SourcesScreenProps> = ({ sources, theme }) => {
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
      key: 'strategies',
      title: 'Strategy',
      // The default strategy first; it's what a bare `extract` takes.
      text: (row: SourceListing) =>
        [...row.strategies]
          .sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)))
          .map(strategy => strategy.name)
          .join(', '),
    },
    {
      key: 'status',
      title: 'Status',
      text: statusOf,
      render: (_, row: SourceListing, text) => (
        <Text color={row.installed && row.supported ? theme.colors.success : theme.colors.textDim}>
          {text}
        </Text>
      ),
    },
    {
      key: 'summary',
      title: 'Description',
      grow: true,
      minWidth: 16,
    },
  ];

  const missing = sources.filter(s => !s.installed).length;

  return (
    <Box flexDirection="column">
      <Table
        title="Sources"
        columns={columns}
        data={sources}
        theme={theme}
        emptyMessage="No sources found matching the specified criteria."
        width={width}
      />

      {sources.length > 0 && (
        <>
          <Text> </Text>
          <Text color={theme.colors.textDim}>
            <Text color={theme.colors.text}>{sources.length}</Text> sources,{' '}
            <Text color={theme.colors.text}>{sources.length - missing}</Text> installed.
          </Text>
          <Text color={theme.colors.textDim}>
            Usage: <Text color={theme.colors.primary}>chronicle extract {'<SOURCE>'}</Text> or{' '}
            <Text color={theme.colors.primary}>chronicle sources info {'<SOURCE>'}</Text>
          </Text>
        </>
      )}
    </Box>
  );
};
