import { stringify } from 'csv-stringify/sync';
import { flatten } from 'flat';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Loader } from '../../loader.js';
import { LoadResult, Record } from '../../types.js';

export class CsvLoader extends Loader<typeof CsvLoader> {
  static override source = 'csv';
  static override schema = z.object({
    output: z.string().optional().describe('Output file path (default: stdout)'),
    headers: z.boolean().default(true).describe('Include column headers in CSV'),
    delimiter: z.string().default(',').describe('CSV delimiter (default: comma)'),
    quote: z.string().default('"').describe('CSV quote character'),
    escape: z.string().default('"').describe('CSV escape character'),
  });

  private rows: any[] = [];
  private headers: string[] = [];

  async load(record: Record): Promise<LoadResult> {
    // Flatten the record data using the same utility as FlattenTransformer
    const flatData = flatten(record.data, { safe: false }) as { [key: string]: any };

    // Convert Date objects to ISO strings for human-readable CSV output
    const processedData: { [key: string]: any } = {};
    for (const [key, value] of Object.entries(flatData)) {
      if (value instanceof Date) {
        processedData[key] = value.toISOString();
      } else {
        processedData[key] = value;
      }
    }

    // Extract headers from first record
    if (this.headers.length === 0) {
      this.headers = Object.keys(processedData);
    }

    // Convert processed data to array of values in header order
    const row = this.headers.map(header => processedData[header] ?? '');
    this.rows.push(row);

    return { success: true, record };
  }

  override async teardown(): Promise<void> {
    if (this.rows.length === 0) return;

    const csvOptions = {
      delimiter: this.config.delimiter,
      quote: this.config.quote,
      escape: this.config.escape,
      header: this.config.headers,
      columns: this.headers,
    };

    const output = stringify(this.rows, csvOptions);

    if (this.config.output) {
      writeFileSync(this.config.output, output);
    } else {
      process.stdout.write(output);
    }
  }
}
