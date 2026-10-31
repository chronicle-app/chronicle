import { describe, expect, it } from 'vitest';
import { makeTestDb } from './testing/testDb.js';
import { FoldBatcher, ingestEvent, processEvent, processEventBatch } from './process.js';
import { serializeSnapshot } from './serialize/snapshot.js';

function claim(i: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const at = new Date(Date.UTC(2026, 6, 17, 10, i)).toISOString();
  return {
    '@type': 'ExecuteAction',
    '@key': ['@type', 'source', 'timestamp'],
    '@assertedAt': at,
    source: 'shell-live',
    timestamp: at,
    agent: {
      '@type': 'Person',
      '@key': ['@type', 'source', 'handle'],
      source: 'shell-live',
      handle: 'andrew',
      sameAs: ['@me'],
    },
    object: {
      '@type': 'Command',
      '@key': ['@type', 'source', 'body', 'action.timestamp'],
      source: 'shell-live',
      body: `cmd ${i}`,
    },
    ...overrides,
  };
}

const count = (sqlite: { prepare(s: string): { get(): unknown } }, table: string): number =>
  (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('FoldBatcher', () => {
  it('folds once per batchSize and once more at flush', async () => {
    const open = makeTestDb();
    try {
      const folds: string[][] = [];
      const batcher = new FoldBatcher(open.db, { batchSize: 3, onFold: cids => folds.push(cids) });
      for (let i = 0; i < 7; i++) {
        const r = await ingestEvent(open.db, claim(i));
        batcher.add(r.cid);
      }
      expect(folds.map(f => f.length)).toEqual([3, 3]);
      expect(batcher.pending).toBe(1);
      // Only the folded assertions have actions so far.
      expect(count(open.sqlite, 'actions')).toBe(6);
      expect(batcher.flush()).toBe(1);
      expect(count(open.sqlite, 'actions')).toBe(7);
      expect(batcher.folds).toBe(3);
      expect(batcher.flush()).toBe(0);
    } finally {
      open.close();
    }
  });
});

describe('processEventBatch', () => {
  it('lands the same derived state as per-event processing', async () => {
    const batched = makeTestDb();
    const direct = makeTestDb();
    try {
      const payloads = Array.from({ length: 9 }, (_, i) => claim(i));
      const result = await processEventBatch(batched.db, payloads, { batchSize: 4 });
      expect(result).toMatchObject({ created: 9, duplicate: 0, failed: 0, folds: 3 });
      for (const p of payloads) await processEvent(direct.db, p);
      expect(serializeSnapshot(batched.db)).toBe(serializeSnapshot(direct.db));
    } finally {
      batched.close();
      direct.close();
    }
  });

  it('captures a validation failure per row and keeps going', async () => {
    const open = makeTestDb();
    try {
      const bad = claim(1, { agent: { '@type': 'Person', source: 'shell-live', handle: 'x' } });
      const outcomes: Array<{ index: number; ok: boolean }> = [];
      const result = await processEventBatch(open.db, [claim(0), bad, claim(2)], {
        onOutcome: (o, index) => outcomes.push({ index, ok: o.ok }),
      });
      expect(result).toMatchObject({ created: 2, duplicate: 0, failed: 1 });
      expect(outcomes).toEqual([
        { index: 0, ok: true },
        { index: 1, ok: false },
        { index: 2, ok: true },
      ]);
      expect(count(open.sqlite, 'actions')).toBe(2);
    } finally {
      open.close();
    }
  });

  it('counts a re-import as duplicates', async () => {
    const open = makeTestDb();
    try {
      const payloads = [claim(0), claim(1)];
      await processEventBatch(open.db, payloads);
      const again = await processEventBatch(open.db, payloads);
      expect(again).toMatchObject({ created: 0, duplicate: 2 });
      expect(count(open.sqlite, 'assertions')).toBe(2);
    } finally {
      open.close();
    }
  });

  it('folds what already landed before a non-validation error propagates', async () => {
    const open = makeTestDb();
    try {
      let seen = 0;
      await expect(
        processEventBatch(open.db, [claim(0), claim(1), claim(2)], {
          batchSize: 10,
          onOutcome() {
            seen += 1;
            // A failure past the ingest gate, as a wedged blob store would be.
            if (seen === 2) throw new Error('disk gone');
          },
        })
      ).rejects.toThrow('disk gone');
      // Rows 0 and 1 were ingested; the error path flushed them into the fold.
      expect(count(open.sqlite, 'assertions')).toBe(2);
      expect(count(open.sqlite, 'actions')).toBe(2);
    } finally {
      open.close();
    }
  });
});

describe('ingest trace', () => {
  it('reports the source off the stored body, and an empty one for a minted confirm', async () => {
    const open = makeTestDb();
    try {
      const traces: Array<Record<string, unknown>> = [];
      const onTrace = (t: Record<string, unknown>) => {
        if (t.phase === 'ingest') traces.push(t);
      };
      await ingestEvent(open.db, claim(0), { onTrace });
      // The same claim sighted again at a later time lands as a confirm — a body
      // that names the claim and carries no source of its own.
      const later = new Date(Date.UTC(2026, 6, 18, 10, 0)).toISOString();
      await ingestEvent(open.db, claim(0, { '@assertedAt': later }), { onTrace });
      await ingestEvent(open.db, claim(0), { onTrace });

      expect(traces.map(t => [t.gate, t.kind, t.source])).toEqual([
        ['new', 'assert', 'shell-live'],
        ['confirm', 'confirm', ''],
        ['duplicate', 'assert', 'shell-live'],
      ]);
    } finally {
      open.close();
    }
  });
});
