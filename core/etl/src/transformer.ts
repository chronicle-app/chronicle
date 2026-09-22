import { Record, Transformation } from './types.js';
import { Logger, createLogger } from '@chronicle.app/logging';

export abstract class Transformer {
  static source: string;
  static description: string;
  static inputSchema: string;
  static outputSchema: string;

  protected config: any;
  protected logger: Logger;

  constructor(config: any = {}) {
    this.config = config;

    // Initialize logger with config flags (similar to Extractor)
    const cls = this.constructor as typeof Transformer;
    this.logger = createLogger({
      prefix: `[${cls.name}]`,
      quiet: config.quiet,
      verbose: config.verbose,
    });
  }

  private createTransformation(): Transformation {
    const constructor = this.constructor as typeof Transformer;
    return {
      name: constructor.name,
      description: constructor.description,
      inputSchema: constructor.inputSchema,
      outputSchema: constructor.outputSchema,
      timestamp: new Date(),
    };
  }

  protected abstract transform(record: Record): Promise<any[]>;

  /**
   * Optional cleanup hook, called by the Runner after the run is fully drained
   * (all records transformed and loaded). Default is a no-op; transformers that
   * allocate run-scoped resources (e.g. temp files) override it.
   */
  public async teardown(): Promise<void> {}

  protected postTransform(_result: any, _record: Record): void {
    // Optional hook for post-transform logic, given the source record (for its
    // extraction metadata). May mutate `_result` in place before it is wrapped.
  }

  protected recordToString(_record: Record): string | null {
    return null;
  }

  public async performTransform(record: Record): Promise<Record[]> {
    const results = await this.transform(record);
    await Promise.all(results.map(result => this.postTransform(result, record)));

    return results.map(result => {
      const newRecord = {
        ...record,
        data: result,
        schema: (this.constructor as typeof Transformer).outputSchema || record.schema,
        transformations: [...record.transformations, this.createTransformation()],
      };

      const toString = this.recordToString(newRecord);
      if (toString !== null) {
        newRecord.toString = toString;
      }

      return newRecord;
    });
  }
}
