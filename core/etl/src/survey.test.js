import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Extractor, MergingExtractor, mergeSurveys } from '../dist/index.js';

// All records in this file are synthetic fixtures.
const day = d => new Date(Date.UTC(2020, 0, d));

test('surveys of one kind add their counts and measures and widen their times', () => {
  const merged = mergeSurveys([
    {
      notes: {
        count: 2,
        earliest: day(5),
        latest: day(9),
        measures: [{ key: 'bytes', label: 'files', value: 10, unit: 'bytes' }],
      },
    },
    {
      notes: {
        count: 3,
        earliest: day(1),
        latest: day(7),
        measures: [
          { key: 'bytes', label: 'files', value: 5, unit: 'bytes' },
          { key: 'tags', label: 'tags', value: 4 },
        ],
      },
      profile: { count: 1, asOf: day(3) },
    },
  ]);
  assert.deepEqual(merged, {
    notes: {
      count: 5,
      earliest: day(1),
      latest: day(9),
      measures: [
        { key: 'bytes', label: 'files', value: 15, unit: 'bytes' },
        { key: 'tags', label: 'tags', value: 4 },
      ],
    },
    profile: { count: 1, asOf: day(3) },
  });
  // Months add up across surveys of a kind.
  assert.deepEqual(
    mergeSurveys([
      { notes: { count: 2, byMonth: { '2020-01': 2 } } },
      { notes: { count: 3, byMonth: { '2020-01': 1, '2020-02': 2 } } },
    ]).notes.byMonth,
    { '2020-01': 3, '2020-02': 2 }
  );
  // The kinds of those that can say, and nothing when none can.
  assert.deepEqual(mergeSurveys([{ notes: { count: 1, label: 'pages' } }, null]), {
    notes: { count: 1, label: 'pages' },
  });
  assert.equal(mergeSurveys([null, null]), null);
  assert.equal(mergeSurveys([]), null);
});

test("an extractor doesn't survey until it says how, and a merge surveys its children", async () => {
  const child = (kind, count) =>
    class extends Extractor {
      static source = 'test';
      static recordTypes = [kind];
      static delivery = 'local';
      static strategy = 'test-db';
      async *extract() {}
      async survey() {
        return { [kind]: { count, earliest: day(count), latest: day(count + 1) } };
      }
    };
  class Silent extends Extractor {
    static source = 'test';
    static recordTypes = ['other'];
    static delivery = 'local';
    static strategy = 'test-db';
    async *extract() {}
  }
  assert.equal(await new Silent({}).survey(), null);

  class Both extends MergingExtractor {
    static source = 'test';
    static delivery = 'local';
    static strategy = 'test-db';
    static children = [child('a', 2), child('b', 5)];
    sortKey() {
      return 0;
    }
  }
  const merge = new Both({});
  await merge.setup();
  assert.deepEqual(await merge.survey(), {
    a: { count: 2, earliest: day(2), latest: day(3) },
    b: { count: 5, earliest: day(5), latest: day(6) },
  });
  await merge.teardown();
});
