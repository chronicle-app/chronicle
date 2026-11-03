import { existsSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { DriverRunResult } from './driver.js';

/**
 * The store's driver on Node: the built-in `node:sqlite`, so the store needs
 * no native module, with the shape of better-sqlite3's API that `SqliteDriver`
 * names. Rows are read as arrays (`StatementSync.setReturnArrays`, which
 * arrived in Node 22.16) and built into objects here.
 */

/** Past this many distinct statements the cache starts over, so SQL built per call can't grow it. */
const STATEMENT_CACHE_LIMIT = 1000;

/**
 * A `node:sqlite` statement that returns rows as arrays, and how to make a row
 * an object. node:sqlite's own row objects have no prototype and slow property
 * access; better-sqlite3's are plain objects, so these are built the same way:
 * the columns assigned in order, giving every row of a statement one shape.
 */
interface Cached {
  stmt: StatementSync;
  row: (values: unknown[]) => Record<string, unknown>;
}

/**
 * A prepared statement as better-sqlite3 hands it out. It runs on the cached
 * statement for its SQL: the store builds most statements per call, and
 * preparing costs more than most queries.
 */
class Statement {
  private readonly cached: Cached;

  constructor(cached: Cached) {
    this.cached = cached;
  }

  run(...params: SQLInputValue[]): DriverRunResult {
    return { changes: Number(this.cached.stmt.run(...params).changes) };
  }

  get(...params: SQLInputValue[]): unknown {
    const values = this.cached.stmt.get(...params) as unknown[] | undefined;
    return values === undefined ? values : this.cached.row(values);
  }

  all(...params: SQLInputValue[]): unknown[] {
    const rows = this.cached.stmt.all(...params) as unknown as unknown[][];
    return rows.map(values => this.cached.row(values));
  }
}

class Database {
  private readonly db: DatabaseSync;
  private readonly statements = new Map<string, Cached>();

  constructor(path: string, options: { readonly?: boolean; fileMustExist?: boolean } = {}) {
    if (options.fileMustExist && path !== ':memory:' && !existsSync(path)) {
      throw new Error(`unable to open database file: ${path}`);
    }
    this.db = new DatabaseSync(path, { readOnly: options.readonly ?? false });
  }

  /** Prepared now (or found in the cache), as better-sqlite3 does, so a bad statement throws here. */
  prepare(sql: string): Statement {
    let cached = this.statements.get(sql);
    if (!cached) {
      if (this.statements.size >= STATEMENT_CACHE_LIMIT) this.statements.clear();
      const stmt = this.db.prepare(sql);
      stmt.setReturnArrays(true);
      const names = stmt.columns().map(column => column.name);
      const row = (values: unknown[]) => {
        const out: Record<string, unknown> = {};
        for (let i = 0; i < names.length; i++) out[names[i]] = values[i];
        return out;
      };
      cached = { stmt, row };
      this.statements.set(sql, cached);
    }
    return new Statement(cached);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  /** Every row the pragma returns, or with `simple` the first column of the first. */
  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all();
    if (!options.simple) return rows;
    const first = rows[0];
    return first === undefined ? undefined : Object.values(first)[0];
  }
}

type Handle = Database;

// The namespace gives the class better-sqlite3's `Database.Database` type name.
declare namespace Database {
  export type Database = Handle;
}

export default Database;
