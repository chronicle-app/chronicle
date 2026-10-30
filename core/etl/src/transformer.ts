import { Record, Transformation } from './types.js';
import {
  Logger,
  createLogger,
  type RecordLabel,
  type RunContext,
  type Sink,
} from '@chronicle.app/logging';

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
      scope: cls.name,
      quiet: config.quiet,
      verbose: config.verbose,
      sensitive: true,
    });
  }

  /** Send this transformer's events to the host's sink, tagged with its run. */
  useOutput(sink: Sink, run?: RunContext): void {
    this.logger.use(sink, { run });
  }

  /**
   * A next step for a person, printed under the run's summary, for a run
   * that succeeded with something missing: `hint('attachments skipped',
   * { action: 'grant Full Disk Access to your terminal to include them' })`.
   * For a failure, throw a typed error with a hint instead.
   */
  protected hint(message: string, { action }: { action: string }): void {
    this.logger.emit({ level: 'info', kind: 'hint', message, hint: { action } });
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

  /**
   * The label of a payload this made, when it can say better than the record
   * it came from. Without one, the payload keeps that record's label.
   */
  protected labelOf(_record: Record): RecordLabel | undefined {
    return undefined;
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

      const label = this.labelOf(newRecord);
      if (label) {
        newRecord.label = label;
      }

      return newRecord;
    });
  }
}
