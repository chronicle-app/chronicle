import React from 'react';
import { Box, Text } from 'ink';
import type { ChronicleTheme } from '../theme.js';

export interface TableColumn {
  key: string;
  title: string;
  /** A fixed width. Without one, the column fits its title and content. */
  width?: number;
  /** Bounds for a column sized to its content, or for a `grow` column's share. */
  minWidth?: number;
  maxWidth?: number;
  /** Share the table's leftover width with the other `grow` columns. */
  grow?: boolean;
  align?: 'left' | 'center' | 'right';
  /** The cell's plain text, used for sizing and truncation. Defaults to the row's value. */
  text?: (row: any) => string;
  /** Renders the cell. `text` is the cell's text, truncated to the column. */
  render?: (value: any, row: any, text: string) => string | React.ReactNode;
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
  /** The width the table may use. `grow` columns fill it; without it they fit their content. */
  width?: number;
}

const GAP = 2;

const cellText = (column: TableColumn, row: TableRow): string =>
  column.text ? column.text(row) : String(row[column.key] ?? '');

export const truncate = (text: string, width: number): string =>
  text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text;

/**
 * Column widths: fixed and content-sized columns keep their width, and `grow`
 * columns split what is left of `width`, each at least its `minWidth` and at
 * most its content.
 */
export const columnWidths = (
  columns: TableColumn[],
  data: TableRow[],
  width?: number
): number[] => {
  const natural = columns.map(column => {
    if (column.width) return column.width;
    const content = Math.max(column.title.length, ...data.map(row => cellText(column, row).length));
    return Math.min(
      Math.max(content, column.minWidth ?? 0),
      column.maxWidth ?? Number.POSITIVE_INFINITY
    );
  });
  if (width === undefined) return natural;

  const widths = columns.map((column, i) =>
    column.grow ? Math.min(column.minWidth ?? column.title.length, natural[i]) : natural[i]
  );
  let left = width - GAP * (columns.length - 1) - widths.reduce((sum, w) => sum + w, 0);
  // Hand out the leftover evenly, capping each grow column at its content.
  let open = columns.map((column, i) => i).filter(i => columns[i].grow && widths[i] < natural[i]);
  while (left > 0 && open.length > 0) {
    const share = Math.max(1, Math.floor(left / open.length));
    for (const i of open) {
      const add = Math.min(share, natural[i] - widths[i], left);
      widths[i] += add;
      left -= add;
    }
    open = open.filter(i => widths[i] < natural[i]);
  }
  return widths;
};

export const Table: React.FC<TableProps> = ({
  columns,
  data,
  title,
  theme,
  showBorder = true,
  emptyMessage = 'No data available',
  width,
}) => {
  const widths = columnWidths(columns, data, width);

  const renderCell = (column: TableColumn, row: TableRow, cellWidth: number): React.ReactNode => {
    const text = truncate(cellText(column, row), cellWidth);
    if (column.render) {
      return column.render(row[column.key], row, text);
    }
    return <Text>{text}</Text>;
  };

  const cellBox = (key: string, index: number, children: React.ReactNode) => (
    <Box
      key={key}
      width={widths[index]}
      flexShrink={0}
      marginRight={index < columns.length - 1 ? GAP : 0}
    >
      {children}
    </Box>
  );

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
            {columns.map((col, index) =>
              cellBox(
                col.key,
                index,
                <Text color={theme.colors.primary} bold>
                  {truncate(col.title, widths[index]).padEnd(widths[index])}
                </Text>
              )
            )}
          </Box>

          {/* Header separator */}
          <Box>
            {columns.map((col, index) =>
              cellBox(
                `sep-${col.key}`,
                index,
                <Text color={theme.colors.textDim}>{'-'.repeat(widths[index])}</Text>
              )
            )}
          </Box>

          {/* Table Rows */}
          {data.map((row, rowIndex) => (
            <Box key={rowIndex}>
              {columns.map((col, colIndex) =>
                cellBox(col.key, colIndex, renderCell(col, row, widths[colIndex]))
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
