import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import type { Db } from './driver.js';
import { sql } from './sql.js';

describe('sql', () => {
  it('binds values, splices fragments, and lists arrays', () => {
    const kind = sql`kind = ${'assert'}`;
    const query = sql`SELECT id FROM assertions WHERE ${kind} AND id IN ${[1, 2, 3]}${undefined}`;
    expect(query.text).toBe('SELECT id FROM assertions WHERE kind = ? AND id IN (?, ?, ?)');
    expect(query.params).toEqual(['assert', 1, 2, 3]);
  });

  it('joins fragments with a separator, and splices raw text as it is', () => {
    const query = sql`SELECT ${sql.raw('cid')} FROM assertions WHERE id IN (${sql.join(
      [4, 5].map(id => sql`${id}`),
      sql`, `
    )})`;
    expect(query.text).toBe('SELECT cid FROM assertions WHERE id IN (?, ?)');
    expect(query.params).toEqual([4, 5]);
  });
});

const count = (db: Db) => db.get<{ n: number }>(sql`SELECT count(*) AS n FROM meta`)!.n;

describe('Db', () => {
  it('commits a transaction that returns, and rolls back one that throws', () => {
    const { db, close } = makeTestDb();
    try {
      db.transaction(tx => tx.run(sql`INSERT INTO meta (key, value) VALUES ('a', '1')`));
      expect(() =>
        db.transaction(tx => {
          tx.run(sql`INSERT INTO meta (key, value) VALUES ('b', '2')`);
          throw new Error('stop');
        })
      ).toThrow('stop');
      expect(count(db)).toBe(1);
    } finally {
      close();
    }
  });

  it('rolls back a nested transaction to its savepoint only', () => {
    const { db, close } = makeTestDb();
    try {
      db.transaction(
        tx => {
          tx.run(sql`INSERT INTO meta (key, value) VALUES ('a', '1')`);
          expect(() =>
            tx.transaction(inner => {
              inner.run(sql`INSERT INTO meta (key, value) VALUES ('b', '2')`);
              throw new Error('stop');
            })
          ).toThrow('stop');
        },
        { behavior: 'immediate' }
      );
      expect(db.all<{ key: string }>(sql`SELECT key FROM meta`)).toEqual([{ key: 'a' }]);
    } finally {
      close();
    }
  });
});
