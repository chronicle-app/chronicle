import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  type DatabaseColumns,
  type DatabaseSchema,
  type Delivery,
  Extractor,
  InputNotFound,
  assertReadable,
  columnsOf,
  matchSchema,
} from '@chronicle.app/etl';
import { snapshot } from './snapshot.js';

/**
 * Refuse an open database unless it has every column one of `databases`
 * needs, naming `path` as what was given. Its columns, when it has them. For
 * a reader that opens its database itself rather than through a
 * {@link SqliteExtractor}.
 */
export function assertDatabaseSchema(
  db: DatabaseSync,
  databases: DatabaseSchema[],
  path: string
): DatabaseColumns {
  const columns = columnsOf(db);
  const match = matchSchema(columns, databases);
  if (!match || match.missing.length > 0 || match.schema.supported === false) {
    throw new InputNotFound(
      match ? 'That’s a version of the database this can’t read' : 'That isn’t the database',
      {
        path,
        ...(match && { fields: { missing: match.missing } }),
        hint: 'Run `chronicle scan <path>` to see what it is.',
      }
    );
  }
  return columns;
}

/** Read an existing source database without changing its journal mode. */
export abstract class SqliteExtractor<
  SelfClass extends typeof SqliteExtractor = typeof SqliteExtractor,
> extends Extractor<SelfClass> {
  static override delivery: Delivery = 'local';
  static override schema = Extractor.schema.extend({
    input: z.string().min(1).describe('Path to an existing SQLite database'),
  });

  /**
   * The tables a reader reads and the columns its queries use, which its
   * manifest's `databases` repeats for `scan`. A reader that declares them
   * reads a snapshot of its input, and only an input with every column a
   * schema needs.
   */
  static databases?: DatabaseSchema[];

  protected db: DatabaseSync | null = null;
  /** The checked database's columns, for {@link has}. */
  private columns: DatabaseColumns | null = null;
  private snapshotDir: string | null = null;

  override async setup(): Promise<void> {
    if (this.db) throw new Error('Database already initialized');
    await super.setup();
    const { input } = this.config as { input: string };
    const { databases } = this.constructor as typeof SqliteExtractor;
    if (!databases) {
      this.db = this.openDatabase(input);
      return;
    }
    assertReadable(input, 'database');
    this.snapshotDir = await mkdtemp(join(tmpdir(), 'chronicle-sqlite-'));
    try {
      this.db = this.openDatabase(await snapshot(input, this.snapshotDir));
      this.assertSchema(databases, input);
    } catch (error) {
      await this.teardown();
      throw error;
    }
  }

  /**
   * Refuse the open database unless it has every column one of `databases`
   * needs, naming `path` as what was given. `setup()` checks a declared
   * schema; a reader that declares none, as one whose input is a copy
   * already, can check one after it.
   */
  protected assertSchema(databases: DatabaseSchema[], path: string): void {
    this.columns = assertDatabaseSchema(this.db!, databases, path);
  }

  /** Whether the database has a column a schema marks as optional, as `table.column`. */
  protected has(column: string): boolean {
    const [table, name] = column.toLowerCase().split('.');
    return this.columns?.get(table)?.has(name) ?? false;
  }

  /**
   * Open a database read-only without changing its journal mode. `setup()`
   * opens `input` with this; subclasses can call it to read another file, such
   * as a copy of a locked database, after closing and clearing `this.db`.
   */
  protected openDatabase(path: string): DatabaseSync {
    // SQLite says only "unable to open database file"; say whether the file
    // is missing or macOS privacy controls refused it.
    assertReadable(path, 'database');
    return new DatabaseSync(path, { readOnly: true });
  }

  override async teardown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (this.snapshotDir) {
      rmSync(this.snapshotDir, { recursive: true, force: true });
      this.snapshotDir = null;
    }
    this.columns = null;
    await super.teardown();
  }
}
