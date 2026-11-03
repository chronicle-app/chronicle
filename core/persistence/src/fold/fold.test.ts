import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { processEvent, processEvents } from '../process.js';
import { serializeSnapshot } from '../serialize/snapshot.js';

function rows(sqlite: any, sql: string, ...args: any[]): any[] {
  return sqlite.prepare(sql).all(...args);
}

/** Runs of a predicate as {value, from, to}, in placement order. */
function runsOf(sqlite: any, predicate: string): any[] {
  return rows(
    sqlite,
    `SELECT v.body AS value, p.cached_period_from AS "from", p.cached_period_to AS "to",
            p.first_observed_valid_at AS firstObserved,
            p.last_confirmed_valid_at AS lastConfirmed
     FROM properties p
     LEFT JOIN vals v ON v.id = p.value_id
     WHERE p.predicate = ?
     ORDER BY p.first_observed_valid_at, p.first_observed_observed_at`,
    predicate
  ).map(r => ({ ...r, value: r.value === null ? null : JSON.parse(r.value) }));
}

/** (key, source, type) of every sourced row. */
function sourcedOf(sqlite: any): any[] {
  return rows(sqlite, 'SELECT key, source, type FROM sourced_entities ORDER BY key').map(
    (r: any) => ({ key: r.key, source: r.source, type: r.type })
  );
}

const agent = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};

// Event-native: a ReadAction is witnessed as it happens, so its sighting axis
// equals its occurrence. Stamp @assertedAt = timestamp (the fold no longer
// borrows the occurrence, and an unstamped payload would be dated implicit-now).
const tRead = (over: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  agent,
  '@key': ['source', 'sourceId'],
  ...(over.timestamp === undefined ? {} : { '@assertedAt': over.timestamp }),
  ...over,
});

const book = (over: Record<string, unknown>) => ({
  '@type': 'Book',
  source: 'test',
  sourceId: 'book-1',
  '@key': ['source', 'sourceId'],
  ...over,
});

describe('fold — entity resolution + runs', () => {
  it('projects a literal property into an open run with an unknown start', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        tRead({
          sourceId: 'r1',
          timestamp: '2023-01-01T00:00:00Z',
          object: book({ name: '1984' }),
        })
      );

      const props = runsOf(sqlite, 'name');
      expect(props).toHaveLength(1);
      expect(props[0].value).toBe('1984');
      // chain-initial run without origin evidence: the start is UNKNOWN; the
      // first sighting is the error bar, not the bound
      expect(props[0].from).toBeNull();
      expect(props[0].to).toBeNull(); // open
      expect(props[0].firstObserved).toBe(Date.parse('2023-01-01T00:00:00Z'));
      expect(props[0].lastConfirmed).toBe(Date.parse('2023-01-01T00:00:00Z'));
    } finally {
      close();
    }
  });

  it('supersedes a single-valued property within a source chain (WE-1)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ name: 'Old Title' }),
        }),
        tRead({
          sourceId: 'r2',
          timestamp: '2020-06-01T00:00:00Z',
          object: book({ name: 'New Title' }),
        }),
      ]);

      const props = runsOf(sqlite, 'name').map(({ value, from, to }) => ({ value, from, to }));
      expect(props).toEqual([
        { value: 'Old Title', from: null, to: Date.parse('2020-06-01T00:00:00Z') },
        { value: 'New Title', from: Date.parse('2020-06-01T00:00:00Z'), to: null },
      ]);
    } finally {
      close();
    }
  });

  it('splits runs when a single-valued property recurs (A → B → A)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ name: 'Title A' }),
        }),
        tRead({
          sourceId: 'r2',
          timestamp: '2020-06-01T00:00:00Z',
          object: book({ name: 'Title B' }),
        }),
        tRead({
          sourceId: 'r3',
          timestamp: '2021-01-01T00:00:00Z',
          object: book({ name: 'Title A' }),
        }),
      ]);

      const props = runsOf(sqlite, 'name').map(({ value, from, to }) => ({ value, from, to }));
      expect(props).toEqual([
        { value: 'Title A', from: null, to: Date.parse('2020-06-01T00:00:00Z') },
        {
          value: 'Title B',
          from: Date.parse('2020-06-01T00:00:00Z'),
          to: Date.parse('2021-01-01T00:00:00Z'),
        },
        { value: 'Title A', from: Date.parse('2021-01-01T00:00:00Z'), to: null },
      ]);
    } finally {
      close();
    }
  });

  it('re-confirmation advances last_confirmed without period writes', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ name: '1984' }),
        }),
        tRead({
          sourceId: 'r2',
          timestamp: '2021-01-01T00:00:00Z',
          object: book({ name: '1984' }),
        }),
      ]);
      const props = runsOf(sqlite, 'name');
      expect(props).toHaveLength(1); // one run, absorbed
      expect(props[0].firstObserved).toBe(Date.parse('2020-01-01T00:00:00Z'));
      expect(props[0].lastConfirmed).toBe(Date.parse('2021-01-01T00:00:00Z'));
      expect(props[0].to).toBeNull();
    } finally {
      close();
    }
  });

  it('keeps multi-valued timelines independent (WE-4)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        tRead({
          sourceId: 'r1',
          timestamp: '2021-01-01T00:00:00Z',
          object: book({ genre: ['dystopia', 'sci-fi'] }),
        })
      );
      const props = runsOf(sqlite, 'genre')
        .map(r => ({ value: r.value, to: r.to }))
        .sort((a, b) => (a.value < b.value ? -1 : 1));
      expect(props).toEqual([
        { value: 'dystopia', to: null },
        { value: 'sci-fi', to: null },
      ]);
    } finally {
      close();
    }
  });

  it('closes a cardinality-one run with an @asserts absence', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ description: 'gloomy' }),
        }),
        // a later snapshot asserting the complete value set, description absent
        tRead({
          sourceId: 'r2',
          timestamp: '2021-01-01T00:00:00Z',
          object: book({ '@asserts': ['description'] }),
        }),
      ]);
      const props = runsOf(sqlite, 'description').map(({ value, from, to }) => ({
        value,
        from,
        to,
      }));
      expect(props).toEqual([
        { value: 'gloomy', from: null, to: Date.parse('2021-01-01T00:00:00Z') },
      ]);
    } finally {
      close();
    }
  });

  it('closes cardinality-many timelines lacking confirmation at a snapshot marker', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ genre: ['dystopia', 'sci-fi'] }),
        }),
        // a later complete snapshot only shows dystopia: sci-fi closes
        tRead({
          sourceId: 'r2',
          timestamp: '2021-01-01T00:00:00Z',
          object: book({ genre: ['dystopia'], '@asserts': ['genre'] }),
        }),
      ]);
      const props = runsOf(sqlite, 'genre')
        .map(({ value, to }) => ({ value, to }))
        .sort((a, b) => (a.value < b.value ? -1 : 1));
      expect(props).toEqual([
        { value: 'dystopia', to: null },
        { value: 'sci-fi', to: Date.parse('2021-01-01T00:00:00Z') },
      ]);
    } finally {
      close();
    }
  });

  it('never minted: a no-manifest payload implies no absence', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ description: 'gloomy' }),
        }),
        // same entity sighted again WITHOUT description and WITHOUT @asserts
        tRead({
          sourceId: 'r2',
          timestamp: '2021-01-01T00:00:00Z',
          object: book({ name: '1984' }),
        }),
      ]);
      const props = runsOf(sqlite, 'description');
      expect(props).toHaveLength(1);
      expect(props[0].to).toBeNull(); // still open
    } finally {
      close();
    }
  });

  it('merges across sources via a bridging keyset, regardless of order (WE-2)', async () => {
    const eventA = tRead({
      sourceId: 'rA',
      timestamp: '2022-01-01T00:00:00Z',
      object: {
        '@type': 'Person',
        source: 'srcA',
        sourceId: 'p1',
        name: 'Jane',
        '@key': ['source', 'sourceId'],
      },
    });
    const eventB = tRead({
      sourceId: 'rB',
      timestamp: '2022-02-01T00:00:00Z',
      object: {
        '@type': 'Person',
        source: 'srcB',
        sourceId: 'p2',
        url: 'https://example.com/jane',
        '@key': ['source', 'sourceId'],
      },
    });
    const eventC = tRead({
      sourceId: 'rC',
      timestamp: '2022-03-01T00:00:00Z',
      object: {
        '@type': 'Person',
        source: 'srcA',
        sourceId: 'p1',
        url: 'https://example.com/jane',
        '@key': ['source', 'sourceId'],
      },
    });

    for (const order of [
      [eventA, eventB, eventC],
      [eventC, eventB, eventA],
      [eventB, eventC, eventA],
    ]) {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvents(db, order);
        const personEntities = sqlite
          .prepare(
            "SELECT COUNT(DISTINCT entity_id) AS n FROM sourced_entities WHERE source IN ('srcA','srcB')"
          )
          .get() as { n: number };
        expect(personEntities.n).toBe(1); // both sources resolve to one entity
      } finally {
        close();
      }
    }
  });

  it('materializes a {url} keyset as a blank sourced node sharing the entity', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvent(
        db,
        tRead({
          sourceId: 'r1',
          timestamp: '2022-01-01T00:00:00Z',
          object: {
            '@type': 'Person',
            source: 'srcA',
            sourceId: 'p1',
            url: 'https://example.com/jane',
            '@key': ['source', 'sourceId'],
          },
        })
      );

      const urlNodes = rows(
        sqlite,
        "SELECT type, keyset, entity_id AS entityId, source FROM sourced_entities WHERE type = 'Entity'"
      );
      expect(urlNodes).toHaveLength(1);
      expect(urlNodes[0].type).toBe('Entity'); // blank node: the bare root, no claim
      // The url identity lives in the `url` namespace, not srcA's: a URL is a
      // portable identifier, not owned by the record that happened to name it.
      expect(urlNodes[0].source).toBe('url');
      expect(JSON.parse(urlNodes[0].keyset)).toEqual({
        source: 'url',
        url: 'https://example.com/jane',
      });

      const og = rows(
        sqlite,
        "SELECT entity_id AS entityId FROM sourced_entities WHERE type = 'Person' AND source = 'srcA'"
      );
      expect(urlNodes[0].entityId).toBe(og[0].entityId); // url node merged with the og
    } finally {
      close();
    }
  });

  it('a url shared by two sources folds to one namespaced url identity, order-independent', async () => {
    const url = 'https://example.com/post/42';
    // A browser visit names the page by url alone (the object carries no source).
    const visit = {
      '@type': 'ViewAction',
      source: 'chrome',
      '@key': ['@type', 'source', 'timestamp'],
      '@assertedAt': '2022-03-01T00:00:00Z',
      timestamp: '2022-03-01T00:00:00Z',
      agent: {
        '@type': 'Person',
        source: 'chrome',
        sourceId: 'me',
        '@key': ['source', 'sourceId'],
      },
      object: { '@type': 'Entity', '@key': ['url'], url, name: 'A Post' },
    };
    // An importer names the same page by its own native id, and carries the url.
    const imported = tRead({
      sourceId: 'i1',
      source: 'importer',
      timestamp: '2022-03-02T00:00:00Z',
      object: {
        '@type': 'Article',
        source: 'importer',
        sourceId: 'a-42',
        url,
        '@key': ['source', 'sourceId'],
      },
    });

    const fold = async (events: unknown[]) => {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvents(db, events);
        const hub = rows(
          sqlite,
          "SELECT source, entity_id AS entityId FROM sourced_entities WHERE json_extract(keyset, '$.url') = ?",
          url
        );
        const importer = rows(
          sqlite,
          "SELECT source, source_id AS sourceId, entity_id AS entityId FROM sourced_entities WHERE source = 'importer'"
        );
        return { hub, importer, sourced: sourcedOf(sqlite), snapshot: serializeSnapshot(db) };
      } finally {
        close();
      }
    };

    const forward = await fold([visit, imported]);
    const reverse = await fold([imported, visit]);

    // The visit and the import merge through the shared {url} hub: the hub and the
    // importer's source-owned row point at the same entity, both arrival orders.
    expect(forward.hub).toHaveLength(1);
    expect(forward.hub[0].entityId).toBe(forward.importer[0].entityId);
    expect(reverse.hub[0].entityId).toBe(reverse.importer[0].entityId);
    // The url identity is namespaced — regardless of which record folded first.
    expect(forward.hub[0].source).toBe('url');
    expect(reverse.hub[0].source).toBe('url');
    // The importer keeps its real source-owned row (source + native id).
    expect(forward.importer[0]).toMatchObject({ source: 'importer', sourceId: 'a-42' });
    // Determinism: the sourced rows (and full derived state) are byte-identical
    // across arrival orders — the url row's source is a function of its key.
    expect(forward.sourced).toEqual(reverse.sourced);
    expect(forward.snapshot).toBe(reverse.snapshot);
  });

  it('bridges two sources through a single shared url node', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'rA',
          timestamp: '2022-01-01T00:00:00Z',
          object: {
            '@type': 'Person',
            source: 'srcA',
            sourceId: 'p1',
            url: 'https://example.com/jane',
            '@key': ['source', 'sourceId'],
          },
        }),
        tRead({
          sourceId: 'rB',
          timestamp: '2022-02-01T00:00:00Z',
          object: {
            '@type': 'Person',
            source: 'srcB',
            sourceId: 'p2',
            url: 'https://example.com/jane',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);

      // one shared url node, not one per source
      const urlNodes = rows(sqlite, "SELECT id FROM sourced_entities WHERE type = 'Entity'");
      expect(urlNodes).toHaveLength(1);

      // both source-native nodes + the url node collapse to one entity
      const entities = rows(
        sqlite,
        "SELECT COUNT(DISTINCT entity_id) AS n FROM sourced_entities WHERE source IN ('srcA','srcB')"
      );
      expect(entities[0].n).toBe(1);
    } finally {
      close();
    }
  });

  it('does not duplicate the url node under re-ingest', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const event = tRead({
        sourceId: 'r1',
        timestamp: '2022-01-01T00:00:00Z',
        object: {
          '@type': 'Person',
          source: 'srcA',
          sourceId: 'p1',
          url: 'https://example.com/jane',
          '@key': ['source', 'sourceId'],
        },
      });
      await processEvents(db, [event, event]);

      const urlNodes = rows(sqlite, "SELECT id FROM sourced_entities WHERE type = 'Entity'");
      expect(urlNodes).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('is idempotent under duplicate processing', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const e = tRead({
        sourceId: 'r1',
        timestamp: '2023-01-01T00:00:00Z',
        object: book({ name: '1984' }),
      });
      await processEvent(db, e);
      await processEvent(db, e);
      await processEvent(db, e);
      const obs = (
        sqlite
          .prepare(`SELECT COUNT(*) AS n FROM observations o WHERE o.predicate = 'name'`)
          .get() as { n: number }
      ).n;
      expect(obs).toBe(1);
      expect(runsOf(sqlite, 'name')).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('folds an ingest-minted attachmentCid as a normal property', async () => {
    const { db, sqlite, blobs, close } = makeTestDb();
    try {
      await processEvent(
        db,
        tRead({
          sourceId: 'r1',
          timestamp: '2023-01-01T00:00:00Z',
          object: {
            '@type': 'ImageObject',
            source: 'test',
            sourceId: 'img-1',
            '@key': ['source', 'sourceId'],
            contentData: `data:image/png;base64,${Buffer.from('pixels').toString('base64')}`,
          },
        }),
        { blobs }
      );

      const props = runsOf(sqlite, 'attachmentCid');
      expect(props).toHaveLength(1);
      const cid = props[0].value;
      expect(cid).toMatch(/^bafkrei/);
      expect(await blobs.has(cid)).toBe(true);
    } finally {
      close();
    }
  });
});

const beat = (assertedAt: string, progress: number) => ({
  '@type': 'ReadAction',
  source: 'reader',
  sourceId: 'session-1',
  timestamp: '2024-01-01T20:00:00Z',
  '@assertedAt': assertedAt,
  '@key': ['source', 'sourceId'],
  agent,
  result: {
    '@type': 'Session',
    source: 'reader',
    sourceId: 'session-1',
    endSelector: {
      '@type': 'Selector',
      source: 'reader',
      sourceId: `sel-${progress}`,
      selectorProgress: progress,
      '@key': ['source', 'sourceId'],
    },
    '@key': ['source', 'sourceId'],
  },
});

describe('fold — actions and heartbeats', () => {
  it('elects the founding payload deterministically (min asserted_at, cid)', async () => {
    const beats = [
      beat('2024-01-01T20:00:00Z', 0.1),
      beat('2024-01-01T20:05:00Z', 0.2),
      beat('2024-01-01T20:10:00Z', 0.3),
    ];
    for (const order of [beats, [...beats].reverse()]) {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvents(db, order);
        const actions = rows(sqlite, 'SELECT asserted_at AS at FROM actions');
        expect(actions).toHaveLength(1); // one keyset, one action
        expect(actions[0].at).toBe(Date.parse('2024-01-01T20:00:00Z')); // earliest beat founds
      } finally {
        close();
      }
    }
  });
});

describe('fold — deletion', () => {
  it('a DeleteAction does not close property runs', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: book({ name: '1984' }),
        }),
        {
          '@type': 'DeleteAction',
          source: 'test',
          sourceId: 'del-1',
          timestamp: '2022-01-01T00:00:00Z',
          agent,
          object: book({}),
          '@key': ['source', 'sourceId'],
        },
      ]);
      // Deletion is evidence about existence only — a deleted book's name run
      // stays open (the name didn't become false).
      const name = runsOf(sqlite, 'name');
      expect(name[0].to).toBeNull();
    } finally {
      close();
    }
  });
});

describe('fold — elections', () => {
  it('elects the latest-confirmed open run across sources; name lands on entities', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const sharedUrl = 'https://example.com/b1';
      await processEvents(db, [
        tRead({
          sourceId: 'r1',
          timestamp: '2020-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 'srcA',
            sourceId: 'a1',
            url: sharedUrl,
            name: 'Old Name',
            '@key': ['source', 'sourceId'],
          },
        }),
        tRead({
          sourceId: 'r2',
          timestamp: '2021-01-01T00:00:00Z',
          object: {
            '@type': 'Book',
            source: 'srcB',
            sourceId: 'b1',
            url: sharedUrl,
            name: 'New Name',
            '@key': ['source', 'sourceId'],
          },
        }),
      ]);
      const names = rows(
        sqlite,
        `SELECT e.cached_name AS name FROM entities e
         JOIN entity_types t ON t.entity_id = e.id AND t.type = 'Book'`
      );
      expect(names).toHaveLength(1);
      expect(names[0].name).toBe('New Name'); // latest last_confirmed wins
    } finally {
      close();
    }
  });
});
