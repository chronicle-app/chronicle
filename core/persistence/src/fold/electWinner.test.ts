import { describe, expect, it } from 'vitest';
import { electWinner, type CandidateRow } from './elect.js';
import { URL_SOURCE } from '../cid/cid.js';

// A neutral candidate; each test overrides exactly the discriminator under test,
// leaving every higher-priority discriminator tied so the winner is decided by
// that one criterion alone.
const base: CandidateRow = {
  predicate: 'name',
  valueId: 1,
  valueSourcedId: null,
  valueLocationId: null,
  literalBody: '"x"',
  literalKey: 'k',
  refKey: null,
  locKey: null,
  locPayload: null,
  objectEntityId: null,
  sourcedKey: 'sk',
  source: 'test',
  canonical: 0,
  periodTo: null,
  lastConfirmedValidAt: 100,
  lastConfirmedObservedAt: 100,
  grade: 0,
};
const row = (o: Partial<CandidateRow>): CandidateRow => ({ ...base, ...o });

// Order-independent: a total, deterministic comparator elects the same winner
// regardless of input order.
const elects = (winner: CandidateRow, loser: CandidateRow) => {
  expect(electWinner([loser, winner])).toBe(winner);
  expect(electWinner([winner, loser])).toBe(winner);
};

describe('electWinner discriminators', () => {
  it('(1) open beats closed', () => {
    elects(row({ periodTo: null }), row({ periodTo: 5 }));
  });

  it('(2) higher grade wins (origin over observed)', () => {
    elects(row({ grade: 1 }), row({ grade: 0 }));
  });

  it('(3) a real source outranks a bare address sighting', () => {
    elects(row({ source: 'test' }), row({ source: URL_SOURCE }));
  });

  it('(4) among addresses, canonical wins', () => {
    elects(row({ source: URL_SOURCE, canonical: 1 }), row({ source: URL_SOURCE, canonical: 0 }));
  });

  it('(5) latest lastConfirmedValidAt wins', () => {
    elects(row({ lastConfirmedValidAt: 200 }), row({ lastConfirmedValidAt: 100 }));
  });

  it('(6) latest lastConfirmedObservedAt wins', () => {
    elects(row({ lastConfirmedObservedAt: 200 }), row({ lastConfirmedObservedAt: 100 }));
  });

  it('(7) lower sourced keyset key wins', () => {
    elects(row({ sourcedKey: 'a' }), row({ sourcedKey: 'b' }));
  });

  it('(8) lower content-hash key wins', () => {
    elects(row({ literalKey: 'a' }), row({ literalKey: 'b' }));
  });

  it('returns undefined for an empty candidate set', () => {
    expect(electWinner([])).toBeUndefined();
  });
});
