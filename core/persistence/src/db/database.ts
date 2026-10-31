import type { Db, SqliteDriver } from './driver.js';
import type { Sql } from './sql.js';

/**
 * The query handle over a driver. Statements are prepared through the driver,
 * which may keep them (the Node driver does), so a statement run again isn't
 * prepared again. Transactions are SQLite's own: `BEGIN` in the mode asked for,
 * and a savepoint for one opened inside another.
 */
export function createDb(driver: SqliteDriver): Db {
  let depth = 0;
  const db: Db = {
    all: <T>({ text, params }: Sql) => driver.prepare(text).all(...params) as T[],
    get: <T>({ text, params }: Sql) => driver.prepare(text).get(...params) as T | undefined,
    run: ({ text, params }: Sql) => driver.prepare(text).run(...params),
    transaction(fn, { behavior = 'deferred' } = {}) {
      if (depth > 0) {
        const savepoint = `sp${depth}`;
        driver.exec(`SAVEPOINT ${savepoint}`);
        depth++;
        try {
          const result = fn(db);
          driver.exec(`RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          driver.exec(`ROLLBACK TO ${savepoint}`);
          driver.exec(`RELEASE ${savepoint}`);
          throw error;
        } finally {
          depth--;
        }
      }
      driver.exec(`BEGIN ${behavior.toUpperCase()}`);
      depth++;
      try {
        const result = fn(db);
        driver.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          driver.exec('ROLLBACK');
        } catch {
          // SQLite already rolled back (some errors end the transaction); the
          // error to surface is the one that got us here.
        }
        throw error;
      } finally {
        depth--;
      }
    },
  };
  return db;
}
