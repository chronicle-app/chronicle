import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { type Delivery, Extractor } from '@chronicle.app/etl';

/** Read an existing source database without changing its journal mode. */
export abstract class SqliteExtractor<
  SelfClass extends typeof SqliteExtractor = typeof SqliteExtractor,
> extends Extractor<SelfClass> {
  static override delivery: Delivery = 'local';
  static override schema = Extractor.schema.extend({
    input: z.string().min(1).describe('Path to an existing SQLite database'),
  });

  protected db: DatabaseSync | null = null;

  override async setup(): Promise<void> {
    if (this.db) throw new Error('Database already initialized');
    await super.setup();
    const { input } = this.config as { input: string };
    this.db = new DatabaseSync(input, { readOnly: true });
  }

  override async teardown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    await super.teardown();
  }
}
