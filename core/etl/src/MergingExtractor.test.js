import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Extractor, MergingExtractor } from '../dist/index.js';

// All records in this file are synthetic fixtures.
/** A child that yields its items (newest-first) as records keyed by `k`. */
function makeChild(source, items) {
  return class Child extends Extractor {
    static source = source;
    static recordTypes = [`${source}-record`];
    static delivery = 'local';
    static strategy = 'test-db';
    async *extract() {
      for (const item of items) yield this.createRecord({ ...item }, { t: item.t });
    }

    async determineCount() {
      const limit = this.getEffectiveLimit();
      return limit === null ? items.length : Math.min(limit, items.length);
    }

    keyOf(record) {
      return record.data.k;
    }
  };
}

class TestMerge extends MergingExtractor {
  static source = 'merge-source';
  static delivery = 'local';
  static strategy = 'test-db';
  static children = [
    makeChild('a', [
      { k: 'a1', t: 100 },
      { k: 'a2', t: 70 },
      { k: 'a3', t: 40 },
      { k: 'a4', t: 10 },
    ]),
    makeChild('b', [
      { k: 'b1', t: 90 },
      { k: 'b2', t: 60 },
      { k: 'b3', t: 30 },
    ]),
    makeChild('c', [
      { k: 'c1', t: 80 },
      { k: 'c2', t: 50 },
      { k: 'c3', t: 20 },
    ]),
  ];

  sortKey(record) {
    return record.context.t;
  }
}

async function collect(extractor) {
  await extractor.setup();
  const out = [];
  try {
    for await (const record of extractor.extract()) out.push(record);
  } finally {
    await extractor.teardown();
  }
  return out;
}

test('merges children into one newest-first stream and limits the merged output', async () => {
  const all = await collect(new TestMerge({}));
  assert.deepEqual(
    all.map(r => r.context.t),
    [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]
  );

  // The limit applies to the merge, not per child: the three newest overall.
  const limited = await collect(new TestMerge({ limit: 3 }));
  assert.deepEqual(
    limited.map(r => r.context.t),
    [100, 90, 80]
  );
  // Each record keeps its child's source and record type for routing.
  assert.deepEqual(
    limited.map(r => [r.extraction.source, r.extraction.recordType]),
    [
      ['a', 'a-record'],
      ['b', 'b-record'],
      ['c', 'c-record'],
    ]
  );
});

test('sums child counts, capped by the limit, and routes keyOf to the producing child', async () => {
  const unbounded = new TestMerge({});
  await unbounded.setup();
  assert.equal(await unbounded.determineCount(), 10);
  await unbounded.teardown();

  const bounded = new TestMerge({ limit: 4 });
  const records = await collect(bounded);
  assert.equal(await bounded.determineCount(), 4);
  assert.deepEqual(
    records.map(r => bounded.keyOf(r)),
    ['a1', 'b1', 'c1', 'a2']
  );
});
