import { z } from 'zod';
import { LoadResult, Record } from './types.js';

type LoaderConfigObjectInput<T extends typeof Loader> = z.input<T['schema']>;
type LoaderConfigObjectOutput<T extends typeof Loader> = z.output<T['schema']>;

export abstract class Loader<SelfClass extends typeof Loader = typeof Loader> {
  static source?: string;
  static schema = z.object({});
  /**
   * Whether the loader prints records to stdout when it has no output file,
   * as the JSON, CSV and YAML loaders do. A host showing live progress on
   * the same terminal stops when such a loader starts, so the two don't mix.
   */
  static printsRecords = true;

  protected config!: LoaderConfigObjectOutput<SelfClass>;

  constructor(config: LoaderConfigObjectInput<SelfClass> = {}) {
    const cls = this.constructor as typeof Loader;
    const { schema } = cls;
    this.config = schema.parse(config);
  }

  public async setup(): Promise<void> {}

  abstract load(record: Record): Promise<LoadResult>;

  public async performLoad(record: Record): Promise<LoadResult> {
    const result = await this.load(record);
    return result;
  }

  public async teardown(): Promise<void> {
    // By default don't do anything
  }
}
