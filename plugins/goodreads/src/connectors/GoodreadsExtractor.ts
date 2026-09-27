import { CsvExtractor, Record, configForIo } from '@chronicle.app/etl';
import { z } from 'zod';
import GoodreadsTransformer from './GoodreadsTransformer.js';

export class GoodreadsExtractor extends CsvExtractor {
  static override source = 'goodreads';
  static override description = 'Shelves and reading history from a CSV export';

  static override delivery = 'export' as const;
  static override strategy = 'csv';
  static override recordTypes = ['shelves'];
  static override default = true;
  // A Goodreads export is a re-read of current shelf state: re-exporting
  // re-reports the same books with their latest shelf/review. So attributes are
  // sighted at read time rather than back-dated to a Date Added/Read event,
  // letting a book moving to-read → read supersede cleanly. See
  // Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = GoodreadsTransformer;

  static override schema = CsvExtractor.schema.extend({
    displayName: z
      .string()
      .optional()
      .describe("Your name, used as the reading agent's display label"),
    userId: z
      .string()
      .optional()
      .describe(
        'Goodreads review-list id (the `{id}-{slug}` in your My Books URL, e.g. 1234567-pat-example). Enables real shelf permalinks.'
      ),
  }) as any;

  /** The CSV's `Book Id` column — Goodreads' own book id, identical in any export. */
  override keyOf(record: Record): string | null {
    return (record.data as { 'Book Id'?: string })['Book Id'] ?? null;
  }

  constructor(config: any) {
    const ioConfig = configForIo(config);
    super({
      ...config,
      ...ioConfig,
      columns: true,
      trimColumns: true,
    });
  }

  override instantiateDefaultTransformer() {
    return new GoodreadsTransformer(this.config);
  }
}
