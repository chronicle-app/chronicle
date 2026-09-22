import Table from 'cli-table3';
import chalk from 'chalk';
import { flatten } from 'flat';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Loader } from '../../loader.js';
import { LoadResult, Record } from '../../types.js';

export class TableLoader extends Loader<typeof TableLoader> {
  static override source = 'table';
  static override schema = z.object({
    output: z.string().optional().describe('Output file path (default: stdout)'),
    headers: z.boolean().default(true).describe('Show column headers in table'),
  });

  private rows: any[] = [];
  private headers: string[] = [];

  async load(record: Record): Promise<LoadResult> {
    // Flatten the record data using the same utility as FlattenTransformer
    const flatData = flatten(record.data, { safe: false }) as { [key: string]: any };

    // Extract headers from first record
    if (this.headers.length === 0) {
      this.headers = Object.keys(flatData);
    }

    // Convert flattened data to array of values in header order
    // Handle Date objects by converting to ISO string
    const row = this.headers.map(header => {
      const value = flatData[header];
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value ?? '';
    });
    this.rows.push(row);

    return { success: true, record };
  }

  override async teardown(): Promise<void> {
    if (this.rows.length === 0) return;

    // Create cli-table3 with Chronicle theme-compatible styling
    const tableOptions: any = {
      style: {
        head: [], // No colors here, we'll apply them with chalk
        border: [], // No colors here, we'll apply them with chalk
        compact: true,
      },
      chars: {
        top: '─',
        'top-mid': '─',
        'top-left': ' ',
        'top-right': ' ',
        bottom: '─',
        'bottom-mid': '─',
        'bottom-left': ' ',
        'bottom-right': ' ',
        left: ' ',
        'left-mid': ' ',
        mid: '─',
        'mid-mid': '─',
        right: ' ',
        'right-mid': ' ',
        middle: ' ',
      },
    };

    // Only add headers if headers is true
    if (this.config.headers) {
      // Apply chalk theme colors to headers
      tableOptions.head = this.headers.map(header => chalk.cyan.bold(header));
    }

    const table = new Table(tableOptions);

    // Add rows to table
    table.push(...this.rows);

    const output = table.toString();

    if (this.config.output) {
      writeFileSync(this.config.output, output);
    } else {
      process.stdout.write(output + '\n');
    }
  }
}
