import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent, processEvents } from '../process.js';

function rows(sqlite: any, sql: string, ...args: any[]): any[] {
  return sqlite.prepare(sql).all(...args);
}

// Identity entities key on @type + source + sourceId,
// so the keyset carries @type and a merge hub can be typed from it.
const person = (over: Record<string, unknown>) => ({
  '@type': 'Person',
  '@key': ['@type', 'source', 'sourceId'],
  ...over,
});

// A ReadAction whose object is the entity under test. The default agent (source
// 'test') is irrelevant to the icloud/email counts below.
const read = (sourceId: string, object: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent: { '@type': 'Person', source: 'test', sourceId: 'me', '@key': ['source', 'sourceId'] },
  '@key': ['source', 'sourceId'],
  sourceId,
  timestamp: '2023-01-01T00:00:00Z',
  object,
});

const icloud = () =>
  person({
    source: 'icloud',
    sourceId: 'p1',
    sameAs: [person({ source: 'email', sourceId: 'e1' })],
  });

const emailNative = () => person({ source: 'email', sourceId: 'e1' });

const distinctEntities = (sqlite: any): number =>
  (
    rows(
      sqlite,
      "SELECT COUNT(DISTINCT entity_id) AS n FROM sourced_entities WHERE source IN ('icloud','email')"
    )[0] as { n: number }
  ).n;

describe('sameAs — identity merge edges', () => {
  it('merges the declaring entity with its sameAs target, regardless of order', async () => {
    for (const order of [
      () => [read('rA', icloud()), read('rB', emailNative())],
      () => [read('rB', emailNative()), read('rA', icloud())],
    ]) {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvents(db, order());
        expect(distinctEntities(sqlite)).toBe(1);
      } finally {
        close();
      }
    }
  });

  it('materializes the sameAs target keyset as a hub carrying the ref source/type', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // Only the declaring (icloud) record is ingested — the email identity
      // exists solely as a sameAs reference.
      await processEvent(db, read('rA', icloud()));

      const emailNode = rows(
        sqlite,
        "SELECT type, keyset, entity_id AS entityId, source FROM sourced_entities WHERE source = 'email'"
      );
      expect(emailNode).toHaveLength(1);
      expect(emailNode[0].type).toBe('Person'); // inherits the ref's own @type
      expect(emailNode[0].source).toBe('email'); // the ref's real source, not icloud
      expect(JSON.parse(emailNode[0].keyset)).toEqual({
        '@type': 'Person',
        source: 'email',
        sourceId: 'e1',
      });

      const og = rows(
        sqlite,
        "SELECT entity_id AS entityId FROM sourced_entities WHERE source = 'icloud'"
      );
      expect(emailNode[0].entityId).toBe(og[0].entityId); // same harmonized entity
    } finally {
      close();
    }
  });

  it('does not record the edge as a property observation', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(db, read('rA', icloud()));
      const obs = rows(
        sqlite,
        "SELECT COUNT(*) AS n FROM observations WHERE predicate = 'sameAs'"
      )[0] as { n: number };
      expect(obs.n).toBe(0);
    } finally {
      close();
    }
  });

  it('is idempotent: re-ingesting does not duplicate the hub', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const e = read('rA', icloud());
      await processEvents(db, [e, e, e]);
      const emailNodes = rows(sqlite, "SELECT id FROM sourced_entities WHERE source = 'email'");
      expect(emailNodes).toHaveLength(1);
      expect(distinctEntities(sqlite)).toBe(1);
    } finally {
      close();
    }
  });
});

describe('differentFrom — cut edges (inert until the un-merge engine)', () => {
  it('neither merges nor materializes the referenced entity, and is not observed', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        read(
          'rA',
          person({
            source: 'icloud',
            sourceId: 'p1',
            differentFrom: [person({ source: 'email', sourceId: 'e1' })],
          })
        )
      );

      // The cut ref is not pulled into identity: no email-sourced row exists.
      expect(rows(sqlite, "SELECT id FROM sourced_entities WHERE source = 'email'")).toHaveLength(
        0
      );
      // And it is not an observation property.
      const obs = rows(
        sqlite,
        "SELECT COUNT(*) AS n FROM observations WHERE predicate = 'differentFrom'"
      )[0] as { n: number };
      expect(obs.n).toBe(0);
    } finally {
      close();
    }
  });

  it('leaves an independently-ingested namesake as a separate entity', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        read(
          'rA',
          person({
            source: 'icloud',
            sourceId: 'p1',
            differentFrom: [person({ source: 'email', sourceId: 'e1' })],
          })
        ),
        read('rB', emailNative()),
      ]);
      // differentFrom has no merge effect, and nothing else links them.
      expect(distinctEntities(sqlite)).toBe(2);
    } finally {
      close();
    }
  });
});

describe('sameAs — properties on the target', () => {
  it("shreds a target's own fields onto the target's row, not the declarer's", async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // goodreads' shape: the ISBN edge carries the title so the edge still
      // names the book when it is what mints it (docs/plugins.md).
      await processEvent(
        db,
        read('r1', {
          '@type': 'Book',
          source: 'goodreads',
          sourceId: 'b9',
          name: 'Nineteen Eighty-Four',
          '@key': ['@type', 'source', 'sourceId'],
          sameAs: [
            {
              '@type': 'Book',
              source: 'isbn',
              sourceId: '9780451524935',
              name: 'Nineteen Eighty-Four',
              '@key': ['@type', 'source', 'sourceId'],
            },
          ],
        })
      );
      const named = sqlite
        .prepare(
          `SELECT se.source AS source, v.body AS body
             FROM observations o
             JOIN sourced_entities se ON se.id = o.subject_id
             JOIN vals v ON v.id = o.value_id
            WHERE o.predicate = 'name' ORDER BY se.source`
        )
        .all() as { source: string; body: string }[];
      // Both rows carry the claim, each from its own node — the isbn edge's
      // title is no longer silently dropped.
      expect(named.map(r => r.source)).toEqual(['goodreads', 'isbn']);
      expect(named.every(r => JSON.parse(r.body) === 'Nineteen Eighty-Four')).toBe(true);
    } finally {
      close();
    }
  });
});
