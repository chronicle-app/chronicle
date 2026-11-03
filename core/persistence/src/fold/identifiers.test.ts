import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';

/**
 * Identifiers (`handle`, `url`) are both identity and fact, and which one they
 * are on a given node is decided by that node's keyset — not globally.
 *
 * Keyed, they cannot change, so the column carries the value and nothing is
 * observed: an hourly crawl of one page must not journal "this url's url is that
 * url" forever. Unkeyed, they can be renamed, so they shred like any other value
 * and the Run is the history.
 */
const visit = (url: string, at: string, title?: string) => ({
  '@type': 'ViewAction',
  source: 'chrome',
  timestamp: at,
  '@assertedAt': at,
  '@key': ['@type', 'source', 'timestamp'],
  agent: {
    '@type': 'Person',
    source: 'chrome',
    handle: 'me',
    '@key': ['@type', 'source', 'handle'],
  },
  object: { '@type': 'Entity', '@key': ['url'], url, ...(title ? { name: title } : {}) },
});

/** A post keyed by its own id, carrying a url it does NOT key on. */
const post = (permalink: string, at: string) => ({
  '@type': 'ReadAction',
  source: 'instagram',
  sourceId: `r-${at}`,
  timestamp: at,
  '@assertedAt': at,
  '@key': ['@type', 'source', 'sourceId'],
  agent: {
    '@type': 'Person',
    source: 'instagram',
    handle: 'me',
    '@key': ['@type', 'source', 'handle'],
  },
  object: {
    '@type': 'Post',
    source: 'instagram',
    sourceId: 'abc123',
    '@key': ['@type', 'source', 'sourceId'],
    url: permalink,
  },
});

const obsCount = (sqlite: SqliteDriver, predicate: string) =>
  (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM observations WHERE predicate = ?`).get(predicate) as {
      n: number;
    }
  ).n;

const sourcedRow = (sqlite: SqliteDriver, where: string) =>
  sqlite.prepare(`SELECT source, handle, url FROM sourced_entities WHERE ${where}`).get() as {
    source: string;
    handle: string | null;
    url: string | null;
  };

const urlRuns = (sqlite: SqliteDriver) =>
  sqlite
    .prepare(
      `SELECT v.body AS value, p.cached_period_to AS to_
         FROM properties p JOIN vals v ON v.id = p.value_id
        WHERE p.predicate = 'url' ORDER BY p.first_observed_valid_at`
    )
    .all() as { value: string; to_: number | null }[];

/** The elected url column for the instagram Post, after folding `ordered`. */
async function postUrlAfter(ordered: unknown[]): Promise<string | null> {
  const { db, sqlite, close } = makeTestDb();
  try {
    await processEvents(db, ordered);
    return sourcedRow(sqlite, `source = 'instagram' AND type = 'Post'`).url;
  } finally {
    close();
  }
}

describe('identifiers: keyed vs observed', () => {
  it('a url-keyed page journals no url observation, however often it is seen', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const url = 'https://example.com/';
      await processEvents(
        db,
        Array.from({ length: 24 }, (_, i) =>
          visit(url, new Date(Date.UTC(2026, 0, 1, i)).toISOString(), 'Example')
        )
      );
      // 24 sightings of one page: the title is a real observation each time, the
      // url is not — it IS the identity and cannot vary.
      expect(obsCount(sqlite, 'url')).toBe(0);
      expect(obsCount(sqlite, 'name')).toBe(24);
      // ...and the address is still there, in the column, without the preimage.
      expect(sourcedRow(sqlite, `source = 'url'`)).toMatchObject({ source: 'url', url });
    } finally {
      close();
    }
  });

  it('a url the record does not key on is observed, and a move becomes a run', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await processEvents(db, [
        post('https://instagram.com/p/old/', '2026-01-01T00:00:00.000Z'),
        post('https://instagram.com/p/new/', '2026-02-01T00:00:00.000Z'),
      ]);
      const runs = urlRuns(sqlite);
      expect(runs.map(r => JSON.parse(r.value))).toEqual([
        'https://instagram.com/p/old/',
        'https://instagram.com/p/new/',
      ]);
      // The old permalink closed when the new one was seen; the new one is open.
      expect(runs[0].to_).not.toBeNull();
      expect(runs[1].to_).toBeNull();
      // The column tracks the elected current value, not the last one written.
      expect(sourcedRow(sqlite, `source = 'instagram' AND type = 'Post'`).url).toBe(
        'https://instagram.com/p/new/'
      );
    } finally {
      close();
    }
  });

  it('the elected column is the same under either arrival order', async () => {
    const events = [
      post('https://instagram.com/p/old/', '2026-01-01T00:00:00.000Z'),
      post('https://instagram.com/p/new/', '2026-02-01T00:00:00.000Z'),
    ];
    // Last-sighting-wins would have made this the newest ARRIVAL, not the newest
    // observation — the order-dependence the election removes.
    expect(await postUrlAfter([...events].reverse())).toBe(await postUrlAfter(events));
  });
});

describe('election authority', () => {
  it("a source's record outranks the browser's rendered title, however recent", async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const url = 'https://example.com/book/42';
      await processEvents(db, [
        // The API names the thing once, early.
        {
          '@type': 'ReadAction',
          source: 'goodreads',
          sourceId: 'r1',
          timestamp: '2026-01-01T00:00:00.000Z',
          '@assertedAt': '2026-01-01T00:00:00.000Z',
          '@key': ['@type', 'source', 'sourceId'],
          agent: {
            '@type': 'Person',
            source: 'goodreads',
            sourceId: 'me',
            '@key': ['@type', 'source', 'sourceId'],
          },
          object: {
            '@type': 'Book',
            source: 'goodreads',
            sourceId: 'b9',
            '@key': ['@type', 'source', 'sourceId'],
            url,
            name: 'Nineteen Eighty-Four',
          },
        },
        // The browser then re-asserts its rendered title, later and repeatedly.
        ...Array.from({ length: 5 }, (_, i) =>
          visit(url, new Date(Date.UTC(2026, 5, 1, i)).toISOString(), 'Amazon.com: 1984 | Books')
        ),
      ]);
      const name = (
        sqlite
          .prepare(`SELECT cached_name AS n FROM entities WHERE cached_name IS NOT NULL`)
          .all() as {
          n: string;
        }[]
      ).map(r => r.n);
      expect(name).toContain('Nineteen Eighty-Four');
      expect(name).not.toContain('Amazon.com: 1984 | Books');
    } finally {
      close();
    }
  });
});

describe('page self-description without a distinct canonical', () => {
  it('lands on the page itself rather than being dropped', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // A site that declares ITSELF canonical — the common case — emits no
      // canonicalVersion, so the address you loaded is already the preferred
      // one and its self-description belongs right there.
      await processEvents(db, [
        {
          '@type': 'ViewAction',
          source: 'chrome',
          timestamp: '2026-07-21T04:00:00.000Z',
          '@assertedAt': '2026-07-21T04:00:00.000Z',
          '@key': ['@type', 'source', 'timestamp'],
          agent: {
            '@type': 'Person',
            source: 'chrome',
            handle: 'me',
            '@key': ['@type', 'source', 'handle'],
            sameAs: ['@me'],
          },
          object: {
            '@type': 'Entity',
            '@key': ['url'],
            url: 'https://ny.com/a.html',
            name: 'A Headline - The Paper',
            description: 'The standfirst.',
            datePublished: '2026-07-15T09:00:00.000Z',
          },
        },
      ]);
      const predicates = (
        sqlite.prepare(`SELECT DISTINCT predicate FROM properties`).all() as {
          predicate: string;
        }[]
      ).map(r => r.predicate);
      expect(predicates).toContain('description');
      expect(predicates).toContain('name');
      // The published date still rides an occurrence rather than a property row.
      const published = sqlite
        .prepare(`SELECT COUNT(*) n FROM actions WHERE type = 'PublishAction'`)
        .get() as { n: number };
      expect(published.n).toBe(1);
    } finally {
      close();
    }
  });
});
