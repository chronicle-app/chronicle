import React from 'react';
import { Box, Text } from 'ink';
import type { ChronicleTheme } from '../theme.js';

export interface TableColumn {
  key: string;
  title: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  render?: (value: any, row: any) => string | React.ReactNode;
}

export interface TableRow {
  [key: string]: any;
}

interface TableProps {
  columns: TableColumn[];
  data: TableRow[];
  title?: string;
  theme: ChronicleTheme;
  showBorder?: boolean;
  emptyMessage?: string;
}

export const Table: React.FC<TableProps> = ({
  columns,
  data,
  title,
  theme,
  showBorder = true,
  emptyMessage = 'No data available',
}) => {
  const renderCell = (value: any, column: TableColumn, row: any): React.ReactNode => {
    if (column.render) {
      return column.render(value, row);
    }
    return <Text>{String(value || '')}</Text>;
  };

  const maxWidth = (column: TableColumn): number => {
    if (column.width) return column.width;

    // Calculate width based on title and data
    const titleWidth = column.title.length;
    const dataWidth = Math.max(...data.map(row => String(row[column.key] || '').length), 0);
    return Math.max(titleWidth, dataWidth, 8); // minimum 8 chars
  };

  return (
    <Box flexDirection="column">
      {title && (
        <>
          <Text color={theme.colors.secondary} bold>
            {title}
          </Text>
          <Text color={theme.colors.textDim}>{'='.repeat(title.length)}</Text>
          <Text> </Text>
        </>
      )}

      {data.length === 0 ? (
        <Text color={theme.colors.textDim}>{emptyMessage}</Text>
      ) : (
        <Box flexDirection="column">
          {/* Table Header */}
          <Box>
            {columns.map((col, index) => {
              const width = maxWidth(col);
              return (
                <Box key={col.key} width={width} marginRight={index < columns.length - 1 ? 2 : 0}>
                  <Text color={theme.colors.primary} bold>
                    {col.title.padEnd(width)}
                  </Text>
                </Box>
              );
            })}
          </Box>

          {/* Header separator */}
          <Box>
            {columns.map((col, index) => {
              const width = maxWidth(col);
              return (
                <Box
                  key={`sep-${col.key}`}
                  width={width}
                  marginRight={index < columns.length - 1 ? 2 : 0}
                >
                  <Text color={theme.colors.textDim}>{'-'.repeat(width)}</Text>
                </Box>
              );
            })}
          </Box>

          {/* Table Rows */}
          {data.map((row, rowIndex) => (
            <Box key={rowIndex}>
              {columns.map((col, colIndex) => {
                const width = maxWidth(col);
                return (
                  <Box
                    key={col.key}
                    width={width}
                    marginRight={colIndex < columns.length - 1 ? 2 : 0}
                  >
                    {renderCell(row[col.key], col, row)}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
