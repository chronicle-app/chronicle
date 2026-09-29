import { stringify } from 'csv-stringify/sync';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Loader } from '../../loader.js';
import { LoadResult, Record } from '../../types.js';
import { columnsOption, Rows } from './columns.js';

export class CsvLoader extends Loader<typeof CsvLoader> {
  static override source = 'csv';
  static override schema = z.object({
    output: z.string().optional().describe('Output file path (default: stdout)'),
    headers: z.boolean().default(true).describe('Include column headers in CSV'),
    columns: columnsOption,
    delimiter: z.string().default(',').describe('CSV delimiter (default: comma)'),
    quote: z.string().default('"').describe('CSV quote character'),
    escape: z.string().default('"').describe('CSV escape character'),
  });

  private rows = new Rows(this.config.columns);

  /** Whether `--columns schema` would show properties this run left out. */
  get collapsed(): boolean {
    return this.rows.collapsed;
  }

  async load(record: Record): Promise<LoadResult> {
    this.rows.add(record.data);
    return { success: true, record };
  }

  override async teardown(): Promise<void> {
    const { columns, rows } = this.rows;
    if (rows.length === 0) return;

    const output = stringify(
      rows.map(row =>
        columns.map(column => {
          const value = row.get(column);
          return value instanceof Date ? value.toISOString() : (value ?? '');
        })
      ),
      {
        delimiter: this.config.delimiter,
        quote: this.config.quote,
        escape: this.config.escape,
        header: this.config.headers,
        columns,
      }
    );

    if (this.config.output) {
      writeFileSync(this.config.output, output);
    } else {
      process.stdout.write(output);
    }
  }
}
