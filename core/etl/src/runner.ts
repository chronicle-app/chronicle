import { Record, RunLog } from './types.js';
import { Extractor } from './extractor.js';
import { Transformer } from './transformer.js';
import { Loader } from './loader.js';
import { Logger, createLogger } from '@chronicle.app/logging';
import { ActionAndChildrenSchema } from '@chronicle.app/schema';

export interface RunnerConfig {
  streamExtraction?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  validateSchema?: boolean;
  /**
   * Keep only these record kinds — the `--type` filter, applied to whatever the
   * extractor yields. Undefined keeps everything, which is what a `--type`-less
   * run means: process every kind the extractor emits.
   */
  recordTypes?: string[];
  /**
   * Cap on records AFTER the type filter. Set only when the extractor emits
   * kinds the run didn't ask for, in which case the extractor is handed no
   * limit of its own — otherwise it would stop counting discarded records.
   */
  limit?: number | null;
}

export class Runner {
  public numRecords: null | number = null;

  private extractor!: Extractor;
  private transformers: Transformer[] = [];
  private loaders: Loader[] = [];
  private config: RunnerConfig;
  private extractedRecords: Record[] = [];
  private validateSchema: boolean = false;
  private logger: Logger;

  private setupStarted = false;
  private ready = false;
  private tornDown = false;
  private loadersTornDown = false;
  private initializedLoaders: Loader[] = [];

  constructor(config: RunnerConfig = { streamExtraction: false }) {
    this.config = config;
    this.validateSchema = config.validateSchema ?? true;
    this.logger = createLogger({
      prefix: '[Runner]',
      quiet: config.quiet,
      verbose: config.verbose,
    });
  }

  // chainable
  addExtractor(extractor: Extractor): Runner {
    this.extractor = extractor;
    return this;
  }

  addTransformer(transformer: Transformer): Runner {
    this.transformers.push(transformer);
    return this;
  }

  addLoader(loader: Loader): Runner {
    this.loaders.push(loader);
    return this;
  }

  async setup(): Promise<void> {
    if (!this.extractor) throw new Error('Runner requires an extractor');
    if (this.setupStarted) throw new Error('Runner instances can only be set up once');
    if (
      this.config.limit !== null &&
      this.config.limit !== undefined &&
      (!Number.isInteger(this.config.limit) || this.config.limit < 0)
    ) {
      throw new Error('Runner limit must be a nonnegative integer');
    }
    this.setupStarted = true;
    await this.extractor.setup();

    for (const loader of this.loaders) {
      this.initializedLoaders.push(loader);
      await loader.setup();
    }

    if (this.config.streamExtraction) {
      this.numRecords = await this.extractor.determineCount();
      if (this.numRecords !== null) {
        this.logVerboseStep(`Determined ${this.numRecords} records to extract`);
      }
    } else {
      this.logVerboseStep('Pre-extracting all records');
      for await (const record of this.extractRecords()) {
        this.extractedRecords.push(record);
      }

      this.numRecords = this.extractedRecords.length;
      this.logVerboseStep(`Pre-extracted ${this.numRecords} records`);
    }
    this.ready = true;
  }

  /** Narrow by record kind, then apply the runner's post-filter limit. */
  private async *extractRecords(): AsyncGenerator<Record> {
    const wanted = this.config.recordTypes;
    const limit = this.config.limit ?? null;
    let kept = 0;

    for await (const record of this.extractor.performExtract()) {
      if (wanted && !wanted.includes(record.extraction.recordType ?? '')) continue;
      yield record;
      kept += 1;
      if (limit !== null && limit > 0 && kept >= limit) break;
    }
  }

  async *runExtraction(): AsyncGenerator<Record> {
    if (!this.ready || this.tornDown)
      throw new Error('Call setup() before running a live pipeline');
    if (this.config.streamExtraction) {
      yield* this.extractRecords();
    } else if (this.extractedRecords.length > 0) {
      for (const record of this.extractedRecords) {
        yield record;
      }
    }
  }

  async *run(): AsyncGenerator<RunLog> {
    for await (const extractedRecord of this.runExtraction()) {
      const log = await this.processRecord(extractedRecord);
      yield log;
    }
  }

  /** Flush loaders before releasing transformer and extractor resources.
   * Call from a finally block, including when setup or extraction fails.
   */
  async teardown(): Promise<void> {
    if (this.tornDown) return;
    this.tornDown = true;
    const errors: unknown[] = [];
    try {
      await this.teardownLoaders();
    } catch (error) {
      errors.push(error);
    }
    for (const transformer of this.transformers) {
      try {
        await transformer.teardown();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.setupStarted) {
      try {
        await this.extractor.teardown();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Pipeline teardown failed');
  }

  async teardownLoaders(): Promise<void> {
    if (this.loadersTornDown) return;
    this.loadersTornDown = true;
    const errors: unknown[] = [];
    for (const loader of this.initializedLoaders) {
      try {
        await loader.teardown();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Loader teardown failed');
  }

  private async processRecord(record: Record): Promise<RunLog> {
    const log: RunLog = { record, results: [] };
    let transformedRecords: Record[];
    try {
      transformedRecords = await this.applyTransformations(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error = message;
      return log;
    }

    if (transformedRecords.length === 0) {
      // The blessed filtering idiom: a transformer returning [] drops the
      // record by design. Observable, and distinct from dropped-with-error.
      log.filtered = true;
      return log;
    }

    for (const transformedRecord of transformedRecords) {
      // Validate Chronicle schema records if validation is enabled
      if (this.validateSchema && this.isChronicleSchemaRecord(transformedRecord)) {
        const validationResult = this.validateChronicleRecord(transformedRecord);
        if (!validationResult.success) {
          (log.validationErrors ??= []).push(validationResult.error ?? 'validation failed');
          continue; // Skip to the next record
        }
      }

      for (const loader of this.loaders) {
        const loadResult = await loader.performLoad(transformedRecord);
        log.results.push(loadResult);
      }
    }

    return log;
  }

  /**
   * Log verbose runner steps (only in verbose mode)
   * @param message The verbose step message
   */
  private logVerboseStep(message: string): void {
    this.logger.verboseInfo(message);
  }

  private async applyTransformations(record: Record): Promise<Record[]> {
    let transformedRecords: Record[] = [record];

    for (const transformer of this.transformers) {
      const newTransformedRecords: Record[] = [];
      for (const transformedRecord of transformedRecords) {
        const transformation = await transformer.performTransform(transformedRecord);
        newTransformedRecords.push(...transformation);
      }

      transformedRecords = newTransformedRecords;
    }

    return transformedRecords;
  }

  private isChronicleSchemaRecord(record: Record): boolean {
    return (
      record.schema === 'chronicle' ||
      record.schema.startsWith('https://schema.chronicle.app/') ||
      record.schema.startsWith('https://ontology.chronicle.app/') ||
      record.schema.startsWith('chronicle:')
    );
  }

  private validateChronicleRecord(record: Record): { success: boolean; error?: string } {
    try {
      const parseResult = ActionAndChildrenSchema.safeParse(record.data);
      if (!parseResult.success) {
        return {
          success: false,
          error: `Schema validation error: ${parseResult.error.message}`,
        };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
