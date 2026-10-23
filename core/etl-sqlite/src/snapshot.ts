import { constants as fsConstants, copyFileSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EXIT_CODES, ExtractorError, delay, type DatabaseSchema } from '@chronicle.app/etl';

/** The files a database is saved in: itself, and its write-ahead log. */
const SAVED = ['', '-wal'];

/**
 * Copy a database and its `-wal` into `dir`, to read it without writing
 * beside it, waiting on an app's lock, or missing what's only in the
 * `-wal` so far. The copy is a clone where the filesystem can make one, as
 * APFS can, which is instant, and a full copy elsewhere. A copy that caught
 * a save is taken again.
 */
export async function snapshot(
  database: string,
  dir: string,
  { attempts = 3, retryMs = 200 }: { attempts?: number; retryMs?: number } = {}
): Promise<string> {
  const copy = join(dir, basename(database));
  for (let attempt = 1; ; attempt++) {
    const before = savedState(database);
    for (const suffix of SAVED) {
      rmSync(copy + suffix, { force: true });
      if (suffix && !statSync(database + suffix, { throwIfNoEntry: false })) continue;
      copyFileSync(database + suffix, copy + suffix, fsConstants.COPYFILE_FICLONE);
    }
    if (before === savedState(database)) return copy;
    if (attempt >= attempts) {
      throw new ExtractorError('The database kept changing while it was copied', {
        code: 'input-busy',
        exitCode: EXIT_CODES.transient,
        hint: 'Run it again in a moment.',
        fields: { path: database },
      });
    }
    await delay(retryMs);
  }
}

/** The size and time each of a database's files was saved, to tell whether one changed. */
function savedState(database: string): string {
  return SAVED.map(suffix => {
    const file = statSync(database + suffix, { throwIfNoEntry: false });
    return file ? `${file.size}:${file.mtimeMs}` : '-';
  }).join(' ');
}

/**
 * Write an empty database with only a schema's tables and columns, for a
 * test that a reader's queries need nothing it doesn't declare. Without
 * `optional`, the columns it does without are left out too.
 */
export function writeSchemaDatabase(
  path: string,
  schema: DatabaseSchema,
  { optional = true }: { optional?: boolean } = {}
): void {
  const db = new DatabaseSync(path);
  try {
    for (const [table, columns] of Object.entries(schema.tables)) {
      const kept = columns
        .filter(column => optional || !column.endsWith('?'))
        .map(column => `"${column.replace(/\?$/, '')}"`);
      db.exec(`CREATE TABLE "${table}" (${kept.join(', ')})`);
    }
  } finally {
    db.close();
  }
}
