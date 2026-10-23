import { constants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

/**
 * What a reader reads from a SQLite database, from
 * `chronicle.sources.<source>.strategies.<strategy>.databases`: each table,
 * and the columns its queries use. A column ending in `?` is one the reader
 * does without, as one an older version of the app didn't write.
 *
 * Every needed column being there is what says a run will read the file;
 * the tables alone only say whose database it probably is.
 */
export interface DatabaseSchema {
  tables: { [table: string]: string[] };
  /** A name to tell this schema from the strategy's others, like the version it's from. */
  name?: string;
  /** False for a schema the plugin recognizes but can't read. */
  supported?: boolean;
}

/** A database's columns, by table, all in lowercase as SQLite compares them. */
export type DatabaseColumns = Map<string, Set<string>>;

/** The schema a database is in, and what it lacks of it. */
export interface SchemaMatch {
  schema: DatabaseSchema;
  /** The needed columns that aren't there, as `table.column`. Empty when a run will read it. */
  missing: string[];
}

const HEADER = Buffer.from('SQLite format 3\0');

/** Whether a file starts as a SQLite database does. False when it can't be opened. */
export async function isSqlite(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, 'r');
  } catch {
    return false;
  }
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(HEADER.length), 0, HEADER.length, 0);
    return bytesRead === HEADER.length && buffer.equals(HEADER);
  } finally {
    await file.close();
  }
}

/**
 * A database's columns, read without writing beside it. Opened immutable, it
 * takes no lock and makes no `-shm` or `-wal`, so a running app holding it
 * doesn't matter. What's still only in a `-wal` isn't seen, which for its
 * tables is nothing but a table made since the app last saved. A Node that
 * can't open it so reads a copy of it instead.
 */
export function readColumns(path: string): DatabaseColumns {
  if (!opensUris()) return readColumnsOfCopy(path);
  const { DatabaseSync } = sqlite();
  return columnsAt(new DatabaseSync(`${pathToFileURL(path).href}?immutable=1`, { readOnly: true }));
}

/** A database's columns, from a copy of it: a clone where the filesystem can make one, as APFS can. */
function readColumnsOfCopy(path: string): DatabaseColumns {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-columns-'));
  try {
    const copy = join(dir, basename(path));
    copyFileSync(path, copy, constants.COPYFILE_FICLONE);
    const { DatabaseSync } = sqlite();
    return columnsAt(new DatabaseSync(copy));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The columns of an open database, which it then closes. */
function columnsAt(db: DatabaseSync): DatabaseColumns {
  try {
    return columnsOf(db);
  } finally {
    db.close();
  }
}

/**
 * `node:sqlite`, loaded when a database is read rather than with this
 * module, since Node 22 warns on stderr that it's experimental as it loads.
 */
function sqlite(): typeof import('node:sqlite') {
  return process.getBuiltinModule('node:sqlite');
}

let urisOpen: boolean | undefined;

/**
 * Whether this Node opens a `file:` URI as SQLite does, as it does from 22.15
 * and 23.11 on. An older one takes it as a file's name, so an in-memory
 * database by URI won't open read-only.
 */
function opensUris(): boolean {
  if (urisOpen === undefined) {
    const { DatabaseSync } = sqlite();
    try {
      new DatabaseSync('file::memory:', { readOnly: true }).close();
      urisOpen = true;
    } catch {
      urisOpen = false;
    }
  }
  return urisOpen;
}

/** The columns of every table and view in an open database. */
export function columnsOf(db: DatabaseSync): DatabaseColumns {
  const rows = db
    .prepare(
      `SELECT m.name AS tbl, p.name AS col FROM sqlite_schema AS m, pragma_table_info(m.name) AS p
       WHERE m.type IN ('table', 'view')`
    )
    .all() as Array<{ tbl: string; col: string }>;
  const columns: DatabaseColumns = new Map();
  for (const { tbl, col } of rows) {
    const table = tbl.toLowerCase();
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(col.toLowerCase());
  }
  return columns;
}

/**
 * The schema a database is in: the first it has every table and needed
 * column of. Failing that, the first it has every table of, with the
 * columns it lacks, as a version the reader doesn't know. Null when it has
 * no schema's tables.
 */
export function matchSchema(
  columns: DatabaseColumns,
  schemas: DatabaseSchema[]
): SchemaMatch | null {
  let partial: SchemaMatch | null = null;
  for (const schema of schemas) {
    const missing: string[] = [];
    const tables = Object.entries(schema.tables);
    if (!tables.every(([table]) => columns.has(table.toLowerCase()))) continue;
    for (const [table, wanted] of tables) {
      const have = columns.get(table.toLowerCase())!;
      for (const column of wanted) {
        if (!column.endsWith('?') && !have.has(column.toLowerCase())) {
          missing.push(`${table}.${column}`);
        }
      }
    }
    if (missing.length === 0) return { schema, missing };
    partial ??= { schema, missing };
  }
  return partial;
}
