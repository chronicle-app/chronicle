import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open.js';
import { processEvents } from '../process.js';
import { queryActionPage, queryEntityIds } from './evaluate.js';
import type { ConstraintNode } from '@chronicle.app/cql';

const agent = {
  '@type': 'Person',
  source: 't',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};
const read = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 't',
  agent,
  '@key': ['source', 'sourceId'],
  ...over,
});
const fts = (value: string): ConstraintNode[] => [{ type: 'fulltext', value }];

describe('full-text search', () => {
  it('FTS5 is available', () => {
    const { sqlite, close } = openDatabase({ path: ':memory:' });
    try {
      sqlite.exec("CREATE VIRTUAL TABLE t USING fts5(x); INSERT INTO t(x) VALUES('hello world');");
      const { n } = sqlite.prepare("SELECT COUNT(*) AS n FROM t WHERE t MATCH 'world'").get() as {
        n: number;
      };
      expect(n).toBe(1);
    } finally {
      close();
    }
  });

  it('matches entity name and description; phrase + multi-term AND', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        read({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 't',
            sourceId: 'b1',
            name: '1984',
            description: 'A dystopian novel by George Orwell',
            '@key': ['source', 'sourceId'],
          },
        }),
        read({
          sourceId: 'r2',
          timestamp: '2020-01-02T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 't',
            sourceId: 'b2',
            name: 'Brave New World',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);

      const q = (v: string) => queryEntityIds(open.sqlite, fts(v));
      expect(q('orwell')).toHaveLength(1); // in description
      expect(q('dystopian')).toHaveLength(1);
      expect(q('world')).toHaveLength(1); // in the second book's name
      expect(q('orwell dystopian')).toHaveLength(1); // AND, both present
      expect(q('orwell huxley')).toHaveLength(0); // AND, huxley absent
      expect(q('nonexistent')).toHaveLength(0);
    } finally {
      open.close();
    }
  });

  it('indexes current text only (supersession drops the old value)', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        read({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 't',
            sourceId: 'b1',
            name: 'Old Name',
            '@key': ['source', 'sourceId'],
          },
        }),
        read({
          sourceId: 'r2',
          timestamp: '2021-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 't',
            sourceId: 'b1',
            name: 'New Name',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);
      expect(queryEntityIds(open.sqlite, fts('New'))).toHaveLength(1);
      expect(queryEntityIds(open.sqlite, fts('Old'))).toHaveLength(0); // superseded, not current
    } finally {
      open.close();
    }
  });

  it('refuses bare text on an action root with the participant spellings', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        read({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 't',
            sourceId: 'b1',
            name: '1984',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);
      const ast: ConstraintNode[] = [
        { type: 'type', value: 'ReadAction' },
        { type: 'fulltext', value: 'orwell' },
      ];
      expect(() => queryActionPage(open.sqlite, ast, {})).toThrowError(
        /actions carry no text of their own.*object:\{ orwell \}/s
      );
    } finally {
      open.close();
    }
  });

  it('combines with structured constraints', async () => {
    const open = openDatabase({ path: ':memory:' });
    try {
      await processEvents(open.db, [
        read({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 't',
            sourceId: 'b1',
            name: 'Orwell Diaries',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);
      // "orwell" AND type:Person -> no (it's a Book)
      const ast: ConstraintNode[] = [
        { type: 'type', value: 'Person' },
        { type: 'fulltext', value: 'orwell' },
      ];
      expect(queryEntityIds(open.sqlite, ast)).toHaveLength(0);
      // type:Book AND "orwell" -> yes
      expect(
        queryEntityIds(open.sqlite, [
          { type: 'type', value: 'Book' },
          { type: 'fulltext', value: 'orwell' },
        ])
      ).toHaveLength(1);
    } finally {
      open.close();
    }
  });
});
