import { CsvExtractor, configForIo } from '@chronicle.app/etl';

/**
 * Base class for Marvin extractors providing shared functionality
 */
export abstract class MarvinExtractor extends CsvExtractor {
  static override source = 'marvin';
  static override delivery = 'export' as const;
  static override strategy = 'csv';

  constructor(config: any) {
    // Transform input flag to IoSchema format
    const ioConfig = configForIo(config);
    super({
      ...config,
      ...ioConfig,
      columns: true, // Ensure we use first line as headers
      trimColumns: true, // Trim whitespace from column names
    });
  }
}
