import { describe, expect, it } from 'vitest';
import { makeTestDb } from '../testing/testDb.js';
import { ingest, ValidationError } from './ingest.js';

const readAction = {
  '@type': 'ReadAction',
  timestamp: '2023-06-15T10:00:00Z',
  '@assertedAt': '2023-06-15T10:00:00Z', // event-native: witnessed as it occurs
  source: 'test',
  sourceId: 'read-june',
  '@key': ['source', 'sourceId'],
  agent: {
    '@type': 'Person',
    name: 'Alice',
    source: 'test',
    sourceId: 'alice-1',
    '@key': ['source', 'sourceId'],
  },
  object: {
    '@type': 'Book',
    name: '1984',
    source: 'test',
    sourceId: 'book-1',
    '@key': ['source', 'sourceId'],
  },
};

describe('ingest (Layer 1)', () => {
  it('appends an event + payload and reports isNew', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const r = await ingest(db, readAction);
      expect(r.isNew).toBe(true);
      const events = sqlite.prepare('SELECT * FROM assertions').all() as any[];
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('assert');
      // `source` is not lifted onto the row; it lives in the stored body only.
      expect(events[0]).not.toHaveProperty('source');
      expect(events[0].asserted_at).toBe(Date.parse('2023-06-15T10:00:00Z'));
      const payloads = sqlite.prepare('SELECT * FROM assertion_payloads').all() as any[];
      expect(payloads).toHaveLength(1);
      expect(JSON.parse(payloads[0].body).source).toBe('test');
      expect(payloads[0].cid).toBe(r.cid);
    } finally {
      close();
    }
  });

  it('is idempotent on CID (re-ingest is a no-op)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const a = await ingest(db, readAction);
      const b = await ingest(db, readAction);
      expect(a.cid).toBe(b.cid);
      expect(a.isNew).toBe(true);
      expect(b.isNew).toBe(false);
      const count = sqlite.prepare('SELECT COUNT(*) AS n FROM assertions').get() as { n: number };
      expect(count.n).toBe(1);
    } finally {
      close();
    }
  });

  it('CID is independent of payload key order', async () => {
    const { db, close } = makeTestDb();
    try {
      const a = await ingest(db, readAction);
      const reordered = {
        object: readAction.object,
        agent: readAction.agent,
        '@key': readAction['@key'],
        sourceId: readAction.sourceId,
        source: readAction.source,
        '@assertedAt': readAction['@assertedAt'],
        timestamp: readAction.timestamp,
        '@type': readAction['@type'],
      };
      const b = await ingest(db, reordered);
      expect(b.cid).toBe(a.cid);
      expect(b.isNew).toBe(false);
    } finally {
      close();
    }
  });

  it('rejects structurally invalid payloads before minting a CID', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await expect(ingest(db, { not: 'an action' })).rejects.toBeInstanceOf(ValidationError);
      const count = sqlite.prepare('SELECT COUNT(*) AS n FROM assertions').get() as { n: number };
      expect(count.n).toBe(0);
    } finally {
      close();
    }
  });

  it('diagnoses an occurrence-only payload (no @assertedAt) but still ingests it implicit-now', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // An un-swept event-native record: it carries `timestamp` (occurrence) but
      // no `@assertedAt`. Ingest sights it implicit-now and surfaces a diagnostic
      // pointing at the likely back-dating bug — never a hard rejection.
      const now = Date.parse('2026-07-15T00:00:00.000Z');
      const { diagnostics } = await ingest(
        db,
        {
          '@type': 'ReadAction',
          source: 'test',
          sourceId: 'occ-only',
          timestamp: '2019-01-01T00:00:00Z',
          '@key': ['source', 'sourceId'],
          agent: readAction.agent,
        },
        { ingestedAt: now }
      );
      expect(diagnostics.some(d => d.includes('no @assertedAt'))).toBe(true);
      const at = sqlite.prepare('SELECT asserted_at AS at FROM assertions LIMIT 1').get() as {
        at: number;
      };
      expect(at.at).toBe(now); // sighted now, NOT back-dated to the 2019 occurrence
    } finally {
      close();
    }
  });
});

const helloBytes = new TextEncoder().encode('hello');
const helloUri = `data:image/png;base64,${Buffer.from(helloBytes).toString('base64')}`;

const sendAction = (sourceId: string) => ({
  '@type': 'CreateAction',
  timestamp: '2023-06-15T10:00:00Z',
  '@assertedAt': '2023-06-15T10:00:00Z', // event-native: witnessed as it occurs
  source: 'test',
  sourceId,
  '@key': ['source', 'sourceId'],
  agent: readAction.agent,
  object: {
    '@type': 'ImageObject',
    source: 'test',
    sourceId: `${sourceId}-img`,
    '@key': ['source', 'sourceId'],
    contentData: helloUri,
  },
});

describe('ingest with attachments', () => {
  it('moves contentData bytes to the blob store and stores metadata', async () => {
    const { db, sqlite, blobs, close } = makeTestDb();
    try {
      const r = await ingest(db, sendAction('s-1'), { blobs });
      expect(r.attachments).toHaveLength(1);
      const [att] = r.attachments;
      expect(att.isNew).toBe(true);
      expect(att.sizeBytes).toBe(helloBytes.byteLength);
      expect(att.mimeType).toBe('image/png');

      // the canonical body references the CID and carries no base64
      const payload = sqlite.prepare('SELECT body FROM assertion_payloads').get() as {
        body: string;
      };
      expect(payload.body).toContain(att.cid);
      expect(payload.body).not.toContain('contentData');
      expect(payload.body).not.toContain('base64');

      expect(await blobs.has(att.cid)).toBe(true);
      expect(Buffer.from(await blobs.get(att.cid)).toString()).toBe('hello');

      const row = sqlite.prepare('SELECT * FROM attachments').get() as any;
      expect(row.cid).toBe(att.cid);
      expect(row.size_bytes).toBe(helloBytes.byteLength);
      expect(row.mime_type).toBe('image/png');
      expect(row.first_observed_assertion_cid).toBe(r.cid);
    } finally {
      close();
    }
  });

  it('re-ingest of the same payload dedupes event and attachment', async () => {
    const { db, sqlite, blobs, close } = makeTestDb();
    try {
      const a = await ingest(db, sendAction('s-1'), { blobs });
      const b = await ingest(db, sendAction('s-1'), { blobs });
      expect(b.cid).toBe(a.cid);
      expect(b.isNew).toBe(false);
      expect(b.attachments[0].isNew).toBe(false);
      const n = sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number };
      expect(n.n).toBe(1);
    } finally {
      close();
    }
  });

  it('two events sharing bytes store one blob; first observer wins', async () => {
    const { db, sqlite, blobs, close } = makeTestDb();
    try {
      const a = await ingest(db, sendAction('s-1'), { blobs });
      const b = await ingest(db, sendAction('s-2'), { blobs });
      expect(b.cid).not.toBe(a.cid);
      expect(a.attachments[0].cid).toBe(b.attachments[0].cid);
      expect(b.attachments[0].isNew).toBe(false);

      const rows = sqlite.prepare('SELECT * FROM attachments').all() as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].first_observed_assertion_cid).toBe(a.cid);
    } finally {
      close();
    }
  });

  it('rejects contentData when no blob store is configured', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await expect(ingest(db, sendAction('s-1'))).rejects.toBeInstanceOf(ValidationError);
      const n = sqlite.prepare('SELECT COUNT(*) AS n FROM assertions').get() as { n: number };
      expect(n.n).toBe(0);
    } finally {
      close();
    }
  });

  it('payloads without contentData mint the same CID as before (no rewrite)', async () => {
    const { db, blobs, close } = makeTestDb();
    try {
      // generateAssertionBodyCID over the raw payload is the pre-attachment
      // behavior; ingest must still match it when there is nothing to rewrite.
      const { generateAssertionBodyCID } = await import('../cid/assertionCid.js');
      const expected = generateAssertionBodyCID(readAction).cid;
      const r = await ingest(db, readAction, { blobs });
      expect(r.cid).toBe(expected);
      expect(r.attachments).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('normalizes live Date objects to ISO strings (in-process == piped ingest)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      // transformers emit `timestamp: new Date(...)`; the in-process store
      // path hands that object straight to ingest
      const live = { ...readAction, timestamp: new Date('2023-06-15T10:00:00Z') };
      const r = await ingest(db, live);

      const event = sqlite.prepare('SELECT asserted_at FROM assertions').get() as {
        asserted_at: number;
      };
      expect(event.asserted_at).toBe(Date.parse('2023-06-15T10:00:00Z'));

      const stored = sqlite.prepare('SELECT body FROM assertion_payloads').get() as {
        body: string;
      };
      const body = JSON.parse(stored.body) as Record<string, unknown>;
      expect(body.timestamp).toBe('2023-06-15T10:00:00.000Z');

      // same extraction through JSON (the pipe path) is the same event
      const piped = JSON.parse(JSON.stringify(live)) as Record<string, unknown>;
      const again = await ingest(db, piped);
      expect(again.cid).toBe(r.cid);
      expect(again.isNew).toBe(false);
    } finally {
      close();
    }
  });
});

const rows = (sqlite: any) =>
  sqlite
    .prepare('SELECT cid, kind, claim_cid AS claimCid, target_key AS targetKey FROM assertions')
    .all() as Array<{ cid: string; kind: string; claimCid: string; targetKey: string | null }>;

// Same body, two different root @assertedAt values → same claim, new sighting.
const seenAt = (assertedAt: string) => ({
  '@type': 'ReadAction',
  source: 'test',
  sourceId: 'r-crawl',
  timestamp: '2019-01-01T00:00:00Z',
  '@assertedAt': assertedAt,
  '@key': ['source', 'sourceId'],
  agent: readAction.agent,
  object: {
    '@type': 'Book',
    source: 'test',
    sourceId: 'b1',
    name: '1984',
    '@key': ['source', 'sourceId'],
  },
});

describe('the three-way ingest gate (claim CID + kinds)', () => {
  it('re-crawling an unchanged record mints a confirm, not a duplicate assert', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const first = await ingest(db, seenAt('2024-01-01T00:00:00.000Z'));
      const second = await ingest(db, seenAt('2024-02-01T00:00:00.000Z'));

      expect(second.isNew).toBe(true); // a new (confirm) Assertion
      expect(second.cid).not.toBe(first.cid); // distinct CID
      expect(second.attachments).toEqual([]);

      const all = rows(sqlite);
      expect(all).toHaveLength(2);
      const assert = all.find(r => r.kind === 'assert')!;
      const confirm = all.find(r => r.kind === 'confirm')!;
      expect(confirm.claimCid).toBe(assert.claimCid); // same claim
      expect(confirm.targetKey).toBeNull(); // no action body
      // The confirm did NOT re-store the full payload — its body is tiny.
      const body = sqlite
        .prepare('SELECT body FROM assertion_payloads WHERE cid = ?')
        .get(confirm.cid) as { body: string };
      const parsed = JSON.parse(body.body) as Record<string, unknown>;
      expect(parsed['@kind']).toBe('confirm');
      expect(parsed.claim).toBe(assert.claimCid);
      expect(parsed.object).toBeUndefined();
    } finally {
      close();
    }
  });

  it('is idempotent: the exact same sighting re-ingested is a no-op (case 1)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await ingest(db, seenAt('2024-01-01T00:00:00.000Z'));
      const again = await ingest(db, seenAt('2024-01-01T00:00:00.000Z'));
      expect(again.isNew).toBe(false);
      expect(rows(sqlite)).toHaveLength(1); // still just the one assert
    } finally {
      close();
    }
  });

  it('re-confirming the same claim at the same time is idempotent on the confirm CID', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      await ingest(db, seenAt('2024-01-01T00:00:00.000Z'));
      await ingest(db, seenAt('2024-02-01T00:00:00.000Z')); // mints confirm
      await ingest(db, seenAt('2024-02-01T00:00:00.000Z')); // same sighting again → no-op
      expect(rows(sqlite).filter(r => r.kind === 'confirm')).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('ingests a confirm body directly (tiny shape, no action schema)', async () => {
    const { db, sqlite, close } = makeTestDb();
    try {
      const r = await ingest(db, {
        '@kind': 'confirm',
        claim: 'bafyclaimcidexample',
        '@assertedAt': '2026-01-01T00:00:00.000Z',
      });
      expect(r.isNew).toBe(true);
      const [row] = rows(sqlite);
      expect(row.kind).toBe('confirm');
      expect(row.claimCid).toBe('bafyclaimcidexample');
      expect(row.targetKey).toBeNull();
    } finally {
      close();
    }
  });

  it('rejects a confirm body carrying no claim CID', async () => {
    const { db, close } = makeTestDb();
    try {
      await expect(
        ingest(db, { '@kind': 'confirm', '@assertedAt': '2026-01-01T00:00:00.000Z' })
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      close();
    }
  });
});
