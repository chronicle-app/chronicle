import { describe, expect, it } from 'vitest';
import { assertPermutationInvariant, projectToSnapshot } from '../testing/permutation.js';

/**
 * Dedicated cardinality-many snapshot-marker cases (Testing section of the
 * design): marker + confirmation at equal placement from different events;
 * a marker arriving before the values it closes; two markers at equal
 * placement. Each is asserted order-independent AND pinned to its expected
 * final state.
 */

const agent = {
  '@type': 'Person',
  source: 'test',
  sourceId: 'me',
  '@key': ['source', 'sourceId'],
};

const crawl = (sourceId: string, timestamp: string, object: Record<string, unknown>) => ({
  '@type': 'ReadAction',
  source: 'test',
  sourceId,
  timestamp,
  '@assertedAt': timestamp, // event-native: witnessed as it occurs
  agent,
  '@key': ['source', 'sourceId'],
  object: {
    '@type': 'Book',
    source: 'test',
    sourceId: 'book-1',
    '@key': ['source', 'sourceId'],
    ...object,
  },
});

interface SnapshotRun {
  predicate: string;
  value: unknown;
  periodTo: number | null;
}

async function genreRuns(events: unknown[]): Promise<SnapshotRun[]> {
  const snapshot = JSON.parse(await projectToSnapshot(events)) as {
    properties: SnapshotRun[];
  };
  return snapshot.properties
    .filter(p => p.predicate === 'genre')
    .sort((a, b) => (String(a.value) < String(b.value) ? -1 : 1));
}

describe('snapshot markers (cardinality-many)', () => {
  it('marker + confirmation at equal placement from different events: confirmation wins', async () => {
    const events = [
      crawl('r1', '2020-01-01T00:00:00Z', { genre: ['dystopia', 'sci-fi'] }),
      // same placement, different events: one re-confirms sci-fi, one asserts
      // a complete snapshot that omits it
      crawl('r2', '2021-01-01T00:00:00Z', { genre: ['sci-fi'] }),
      crawl('r3', '2021-01-01T00:00:00Z', { genre: ['dystopia'], '@asserts': ['genre'] }),
    ];
    await assertPermutationInvariant(events, { seed: 11, orders: 30 });

    const runs = await genreRuns(events);
    // both genres survive: each is confirmed at the marker's placement
    expect(runs.map(r => ({ value: r.value, to: r.periodTo }))).toEqual([
      { value: 'dystopia', to: null },
      { value: 'sci-fi', to: null },
    ]);
  });

  it('marker arriving before the values it closes (event order ≠ placement order)', async () => {
    const events = [
      // the marker event is FIRST in arrival order but placed LATER
      crawl('r-marker', '2021-01-01T00:00:00Z', { genre: ['dystopia'], '@asserts': ['genre'] }),
      crawl('r-values', '2020-01-01T00:00:00Z', { genre: ['dystopia', 'sci-fi'] }),
    ];
    await assertPermutationInvariant(events, { seed: 12, orders: 30 });

    const runs = await genreRuns(events);
    expect(runs.map(r => ({ value: r.value, to: r.periodTo }))).toEqual([
      { value: 'dystopia', to: null },
      { value: 'sci-fi', to: Date.parse('2021-01-01T00:00:00Z') },
    ]);
  });

  it('two markers at equal placement collapse to one close', async () => {
    const events = [
      crawl('r1', '2020-01-01T00:00:00Z', { genre: ['dystopia'] }),
      crawl('r2', '2021-01-01T00:00:00Z', { '@asserts': ['genre'] }),
      crawl('r3', '2021-01-01T00:00:00Z', { name: 'x', '@asserts': ['genre'] }),
    ];
    await assertPermutationInvariant(events, { seed: 13, orders: 30 });

    const runs = await genreRuns(events);
    expect(runs).toHaveLength(1);
    expect(runs[0].periodTo).toBe(Date.parse('2021-01-01T00:00:00Z'));
  });

  it('a marker placed before any sighting never creates or closes a run', async () => {
    const events = [
      crawl('r-marker', '2019-01-01T00:00:00Z', { '@asserts': ['genre'] }),
      crawl('r-values', '2020-01-01T00:00:00Z', { genre: ['dystopia'] }),
    ];
    await assertPermutationInvariant(events, { seed: 14, orders: 20 });

    const runs = await genreRuns(events);
    expect(runs).toHaveLength(1);
    expect(runs[0].periodTo).toBeNull(); // unaffected by the earlier marker
  });
});
