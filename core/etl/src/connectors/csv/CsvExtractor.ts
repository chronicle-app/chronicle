import fs from 'node:fs';
import { parse, Options } from 'csv-parse';
import { Extractor } from '../../extractor.js';
import { Record } from '../../types.js';
import { IoSchema, createReadStream } from '../../io-extractor-helper.js';
import { z } from 'zod';

export type CsvExtractorConfig = z.infer<typeof CsvExtractor.schema>;

export class CsvExtractor extends Extractor<typeof CsvExtractor> {
  static override schema = Extractor.schema.merge(IoSchema).extend({
    // CSV parsing options
    delimiter: z.string().optional().describe('Field delimiter character (default: auto-detect)'),
    quote: z.string().optional().describe('Quote character (default: ")'),
    escape: z.string().optional().describe('Escape character (default: ")'),
    columns: z
      .union([z.boolean(), z.array(z.string())])
      .optional()
      .describe('Use first line as headers (true), provide column names, or use indexes (false)'),
    skipEmptyLines: z.boolean().optional().describe('Skip empty lines (default: false)'),
    skipLinesWithError: z
      .boolean()
      .optional()
      .describe('Skip lines with parsing errors (default: false)'),
    recordType: z
      .string()
      .optional()
      .describe('Type to assign to all records (default: "csv-row")'),
    trimColumns: z
      .boolean()
      .optional()
      .describe('Trim whitespace from column names (default: true)'),
    trimValues: z.boolean().optional().describe('Trim whitespace from values (default: false)'),
  });

  static override description = 'Extract from CSV source';
  static override source = 'csv';
  static override delivery = 'export' as const;
  static override strategy = 'csv';
  static override recordTypes = ['csv-rows'];

  protected getParseOptions(): Options {
    const options: Options = {
      columns: this.config.columns ?? true,
      skip_empty_lines: this.config.skipEmptyLines ?? false,
      skip_records_with_error: this.config.skipLinesWithError ?? false,
    };

    if (this.config.delimiter) options.delimiter = this.config.delimiter;
    if (this.config.quote) options.quote = this.config.quote;
    if (this.config.escape) options.escape = this.config.escape;

    return options;
  }

  protected processRow(row: any): any {
    if (typeof row === 'object' && row !== null && this.config.trimColumns) {
      // Trim whitespace from column names
      const trimmedRow: any = {};
      for (const [key, value] of Object.entries(row)) {
        const trimmedKey = typeof key === 'string' ? key.trim() : key;
        let processedValue = value;

        if (this.config.trimValues && typeof value === 'string') {
          processedValue = value.trim();
        }

        trimmedRow[trimmedKey] = processedValue;
      }
      return trimmedRow;
    }

    if (this.config.trimValues && typeof row === 'string') {
      return row.trim();
    }

    return row;
  }

  override async determineCount() {
    // Only count if we have a filename
    if (!this.config.filename) {
      return null;
    }

    const file = fs.readFileSync(this.config.filename, 'utf8');
    const lines = file.split('\n').filter(line => line.trim().length > 0);

    // Subtract 1 if we're using headers
    const hasHeaders = this.config.columns !== false;
    return Math.max(0, lines.length - (hasHeaders ? 1 : 0));
  }

  async *extract(): AsyncGenerator<Record> {
    const stream = createReadStream(this.config);
    const parseOptions = this.getParseOptions();
    const parser = stream.pipe(parse(parseOptions));

    const forwardError = (error: Error) => parser.destroy(error);
    stream.on('error', forwardError);
    try {
      let count = 0;
      for await (const row of parser) {
        if (this.config.limit && count >= this.config.limit) break;
        yield this.createRecord(this.processRow(row));
        count++;
      }
    } finally {
      parser.destroy();
      stream.destroy();
      stream.removeListener('error', forwardError);
    }
  }
}
