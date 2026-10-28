import { existsSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import {
  createTableRelationsHelpers,
  DefaultLogger,
  extractTablesRelationalConfig,
  type Logger,
} from 'drizzle-orm';
import { BetterSQLiteSession } from 'drizzle-orm/better-sqlite3/session';
import { BaseSQLiteDatabase, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

/**
 * The part of better-sqlite3's API the store and Drizzle's better-sqlite3
 * session use, over the built-in `node:sqlite`, so the store needs no native
 * module. Array rows (`raw()`) need `StatementSync.setReturnArrays`, which
 * arrived in Node 22.16.
 */

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

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
 * statement for its SQL: Drizzle prepares every query again each time it runs,
 * and preparing costs more than most queries.
 */
class Statement {
  private readonly cached: Cached;
  private arrays = false;

  constructor(cached: Cached) {
    this.cached = cached;
  }

  run(...params: SQLInputValue[]): RunResult {
    const { changes, lastInsertRowid } = this.cached.stmt.run(...params);
    return { changes: Number(changes), lastInsertRowid };
  }

  get(...params: SQLInputValue[]): unknown {
    const values = this.cached.stmt.get(...params) as unknown[] | undefined;
    return values === undefined || this.arrays ? values : this.cached.row(values);
  }

  all(...params: SQLInputValue[]): unknown[] {
    const rows = this.cached.stmt.all(...params) as unknown as unknown[][];
    return this.arrays ? rows : rows.map(values => this.cached.row(values));
  }

  /** Rows as arrays of column values in column order, for every later call. */
  raw(toggle = true): this {
    this.arrays = toggle;
    return this;
  }
}

/** A transaction function: deferred when called directly, or in the mode named. */
export type Transaction<A extends unknown[], R> = ((...args: A) => R) & {
  deferred: (...args: A) => R;
  immediate: (...args: A) => R;
  exclusive: (...args: A) => R;
};

class Database {
  private readonly db: DatabaseSync;
  private savepoints = 0;
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

  get inTransaction(): boolean {
    return this.db.isTransaction;
  }

  /** Every row the pragma returns, or with `simple` the first column of the first. */
  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all();
    if (!options.simple) return rows;
    const first = rows[0];
    return first === undefined ? undefined : Object.values(first)[0];
  }

  /** As better-sqlite3: inside another transaction, the function runs in a savepoint. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): Transaction<A, R> {
    const wrap =
      (mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') =>
      (...args: A): R => {
        if (this.db.isTransaction) {
          const savepoint = `tx${this.savepoints++}`;
          this.db.exec(`SAVEPOINT ${savepoint}`);
          try {
            const result = fn(...args);
            this.db.exec(`RELEASE ${savepoint}`);
            return result;
          } catch (error) {
            this.db.exec(`ROLLBACK TO ${savepoint}`);
            this.db.exec(`RELEASE ${savepoint}`);
            throw error;
          } finally {
            this.savepoints--;
          }
        }
        this.db.exec(`BEGIN ${mode}`);
        try {
          const result = fn(...args);
          this.db.exec('COMMIT');
          return result;
        } catch (error) {
          if (this.db.isTransaction) this.db.exec('ROLLBACK');
          throw error;
        }
      };
    return Object.assign(wrap('DEFERRED'), {
      deferred: wrap('DEFERRED'),
      immediate: wrap('IMMEDIATE'),
      exclusive: wrap('EXCLUSIVE'),
    });
  }
}

type Handle = Database;

// The namespace gives the class better-sqlite3's `Database.Database` type name.
declare namespace Database {
  export type Database = Handle;
}

export default Database;

/** Drizzle's better-sqlite3 database over a `node:sqlite` handle, as its own driver builds one. */
export function drizzle<TSchema extends Record<string, unknown>>(
  client: Database,
  config: { schema?: TSchema; logger?: boolean | Logger } = {}
): BaseSQLiteDatabase<'sync', RunResult, TSchema> {
  const dialect = new SQLiteSyncDialect();
  const logger =
    config.logger === true
      ? new DefaultLogger()
      : config.logger === false
        ? undefined
        : config.logger;
  let schema;
  if (config.schema) {
    const tablesConfig = extractTablesRelationalConfig(config.schema, createTableRelationsHelpers);
    schema = {
      fullSchema: config.schema,
      schema: tablesConfig.tables,
      tableNamesMap: tablesConfig.tableNamesMap,
    };
  }
  const session = new BetterSQLiteSession(client as never, dialect, schema, { logger });
  return new BaseSQLiteDatabase('sync', dialect, session as never, schema as never) as never;
}
