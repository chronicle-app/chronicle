import { describe, expect, it } from 'vitest';
import type { SqliteDriver } from '../db/driver.js';
import { makeTestDb } from '../testing/testDb.js';
import { processEvents } from '../process.js';
import { generateAssertionBodyCID } from '../cid/assertionCid.js';

const me = { '@type': 'Person', source: 'test', sourceId: 'me', '@key': ['source', 'sourceId'] };

// An assert and a restated of the SAME action (same keyset: source + sourceId)
// at the SAME asserted_at. They found one action; the founding election must pick
// the assert on the kind rank — the store re-quoting itself never repoints
// founding onto a restated Assertion. `sourceId: r3` is chosen so the restated's
// CID sorts BEFORE the assert's: a pure `(asserted_at, cid)` tiebreak would pick
// the restated, so only the kind rank makes the assert win — the test isolates it.
const AT = '2024-01-01T00:00:00.000Z';
const action = (kind?: 'restated') => ({
  '@type': 'ReadAction',
  source: 'test',
  sourceId: 'r3',
  timestamp: '2019-01-01T00:00:00Z',
  '@assertedAt': AT,
  ...(kind ? { '@kind': kind } : {}),
  '@key': ['source', 'sourceId'],
  agent: me,
  object: {
    '@type': 'Book',
    source: 'test',
    sourceId: 'b1',
    name: '1984',
    '@key': ['source', 'sourceId'],
  },
});

const foundingKind = (sqlite: SqliteDriver): string =>
  (
    sqlite
      .prepare(
        `SELECT asr.kind AS kind
           FROM actions ac
           JOIN assertions asr ON asr.cid = ac.founding_assertion_cid
          WHERE ac.type = 'ReadAction'`
      )
      .get() as { kind: string }
  ).kind;

describe('kind-ranked founding election', () => {
  it('the restated CID sorts first — so a cid-only tiebreak would pick it (fixture guard)', () => {
    const assertCid = generateAssertionBodyCID(action()).cid;
    const restatedCid = generateAssertionBodyCID(action('restated')).cid;
    expect(restatedCid < assertCid).toBe(true);
  });

  it('an assert wins founding over a same-time restated, in either arrival order', async () => {
    for (const order of [
      [action(), action('restated')],
      [action('restated'), action()],
    ]) {
      const { db, sqlite, close } = makeTestDb();
      try {
        await processEvents(db, order);
        // Two distinct claims (assert vs restated differ in @kind), one action.
        expect(
          (sqlite.prepare('SELECT count(*) AS n FROM assertions').get() as { n: number }).n
        ).toBe(2);
        expect((sqlite.prepare('SELECT count(*) AS n FROM actions').get() as { n: number }).n).toBe(
          1
        );
        expect(foundingKind(sqlite)).toBe('assert');
      } finally {
        close();
      }
    }
  });
});
