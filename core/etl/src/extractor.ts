import { z } from 'zod';
import { Delivery, Record } from './types.js';
import { Transformer } from './transformer.js';
import { Logger, createLogger } from '@chronicle.app/logging';

// type ExtractorConfig<T extends typeof Extractor> = z.infer<T['schema']>;
type ExtractorConfigObjectInput<T extends typeof Extractor> = z.input<T['schema']>;
type ExtractorConfigObjectOutput<T extends typeof Extractor> = z.output<T['schema']>;

export abstract class Extractor<SelfClass extends typeof Extractor = typeof Extractor> {
  static defaultTransformer: any;
  static description: string;
  static source: string; // TODO: enumerate these
  static recordTypes: string[]; // TODO: derive these from schema
  /**
   * How this source's history reaches us — the catalog classification, never
   * typed by a user. Two questions decide it: could a re-read next week differ,
   * and do you hand it a path or does it know where to look?
   *
   * - `'export'`: handed a path, frozen (a takeout, an mbox dump, a chat backup)
   * - `'local'`: knows the path, live (chat.db, a vault, shell history)
   * - `'api'`: remote, live, needs auth
   * - `'direct'`: the app pushes to us — reserved; no extractor pulls it
   */
  static delivery: Delivery;
  /**
   * The named way history enters, in the source's own vocabulary — what a
   * person picks with `--via` and what `sources info <source>` lists. YouTube
   * declares `api` and `takeout`; email declares `mbox`. Unique per source, and
   * shared by every extractor class reading that same way in (YouTube's four
   * API extractors are all `api`; `--type` selects within).
   *
   * Never a delivery word: `export`/`local`/`direct` say how a source reaches
   * us, not what its users call the thing they hand us.
   */
  static strategy: string;
  static default?: boolean; // Whether this is the default extractor for the source
  /** How the source describes its records; no store annotations are injected. */
  static temporality: 'event' | 'snapshot' = 'event';

  static schema = z.object({
    since: z.date().optional().describe('The date from which to start extracting records'),
    until: z.date().optional().describe('The date until which to extract records'),
    limit: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('The maximum number of records to extract'),
  });

  protected config!: ExtractorConfigObjectOutput<SelfClass>;
  protected logger!: Logger;
  /** When this extraction run began — one crawl time for the whole run. */
  private readonly startedAt = new Date();
  constructor(config: ExtractorConfigObjectInput<SelfClass>) {
    const cls = this.constructor as typeof Extractor;

    if (!cls.delivery) {
      throw new Error('Extractor must define a delivery');
    }

    if (!cls.strategy) {
      throw new Error('Extractor must define a strategy');
    }

    const { schema } = cls;
    this.config = schema.parse(config);

    // Parse CLI flags for logging control
    const configWithFlags = config as any;

    // Initialize logger with config flags
    // Force quiet mode when stdout is not a TTY to avoid contaminating data output
    const forceQuiet = configWithFlags.quiet || !process.stdout.isTTY;
    this.logger = createLogger({
      prefix: `[${cls.strategy || cls.name}]`,
      quiet: forceQuiet,
      verbose: configWithFlags.verbose,
    });
  }

  // Overridable method for setup tasks
  async setup(): Promise<void> {
    this.logVerboseStep('Initializing extraction');
  }

  // Overridable method for determining the number of records to extract
  async determineCount(): Promise<number | null> {
    return null;
  }

  // An async generator that yields extracted records
  abstract extract(): AsyncGenerator<Record>;

  /** The extraction-only stream has no store-backed resume cursor. */
  async *performExtract(): AsyncGenerator<Record> {
    yield* this.extract();
  }

  // Overridable method for teardown
  async teardown(): Promise<void> {
    this.logVerboseStep('Teardown complete');
  }

  /**
   * Log initialization steps automatically
   * @param message The initialization step message
   */
  protected logInitStep(message: string): void {
    this.logger.info(message);
  }

  /**
   * Log verbose initialization steps (only in verbose mode)
   * @param message The verbose step message
   */
  protected logVerboseStep(message: string): void {
    this.logger.verboseInfo(message);
  }

  instantiateDefaultTransformer(): Transformer {
    const TransformerClass = (this.constructor as typeof Extractor).defaultTransformer;
    return new TransformerClass();
  }

  recordToString(_data?: any): string {
    return `${(this.constructor as typeof Extractor).source}.${(this.constructor as typeof Extractor).recordTypes?.[0]}`;
  }

  /**
   * Get the effective limit for extraction, handling the "0 means no limit" convention
   * @returns The limit number, or null for no limit
   */
  protected getEffectiveLimit(): number | null {
    return this.config.limit === 0 ? null : (this.config.limit ?? null);
  }

  /**
   * Check if extraction should stop based on current record count and configured limit
   * @param currentCount The current number of records extracted
   * @returns True if extraction should stop, false otherwise
   */
  protected shouldStopExtracting(currentCount: number): boolean {
    const limit = this.getEffectiveLimit();
    return limit !== null && currentCount >= limit;
  }

  /**
   * The "as of" time for a snapshot read — the sighting axis. Base returns the
   * run start (one crawl time per run, not a per-record clock read). A file/db
   * extractor reading a static artifact may override this with the artifact's
   * mtime so re-runs over unchanged data stay byte-identical no-ops.
   */
  protected asOfTime(): Date {
    return this.startedAt;
  }

  protected createRecord(data: any, context: any = {}): Record {
    const cls = this.constructor as typeof Extractor;
    return {
      data,
      context,
      extraction: {
        source: cls.source,
        recordType: context.recordType || cls.recordTypes?.[0],
        delivery: cls.delivery,
        temporality: cls.temporality,
        assertedAt: this.asOfTime().toISOString(),
      },
      transformations: [],
      schema: 'raw',
      toString: this.recordToString(data),
    };
  }
}
