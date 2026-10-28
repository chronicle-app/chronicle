import { describe, expect, it } from 'vitest';
import { generateAssertionBodyCID, generateClaimCID } from './assertionCid.js';

const base = {
  '@type': 'ReadAction',
  source: 'test',
  sourceId: 'r1',
  timestamp: '2019-01-01T00:00:00.000Z',
  '@key': ['source', 'sourceId'],
  object: {
    '@type': 'Book',
    source: 'test',
    sourceId: 'b1',
    name: '1984',
    '@key': ['source', 'sourceId'],
  },
};

describe('generateClaimCID', () => {
  it('is invariant to the root @assertedAt (same claim, different sighting)', () => {
    const seenIn2019 = { ...base, '@assertedAt': '2019-01-01T00:00:00.000Z' };
    const seenIn2026 = { ...base, '@assertedAt': '2026-07-15T00:00:00.000Z' };
    // Different sightings → different assertion CIDs...
    expect(generateAssertionBodyCID(seenIn2019).cid).not.toBe(
      generateAssertionBodyCID(seenIn2026).cid
    );
    // ...but the SAME claim.
    expect(generateClaimCID(seenIn2019)).toBe(generateClaimCID(seenIn2026));
  });

  it('equals the claim CID of the same body with no root stamp at all', () => {
    const stamped = { ...base, '@assertedAt': '2020-05-05T00:00:00.000Z' };
    expect(generateClaimCID(stamped)).toBe(generateClaimCID(base));
  });

  it('is order-independent (deep canonicalization)', () => {
    const reordered = {
      object: base.object,
      '@key': base['@key'],
      timestamp: base.timestamp,
      sourceId: base.sourceId,
      source: base.source,
      '@type': base['@type'],
      '@assertedAt': '2021-01-01T00:00:00.000Z',
    };
    expect(generateClaimCID(reordered)).toBe(generateClaimCID(base));
  });

  it('keeps NESTED scoped @assertedAt (inner vintages are part of the claim)', () => {
    const withNested = {
      ...base,
      '@assertedAt': '2026-01-01T00:00:00.000Z',
      object: { ...base.object, '@assertedAt': '2026-01-01T00:00:00.000Z' },
    };
    // Stripping only the ROOT stamp, the nested one still distinguishes the claim.
    expect(generateClaimCID(withNested)).not.toBe(generateClaimCID(base));
  });

  it('changes when the claim content changes', () => {
    const different = { ...base, object: { ...base.object, name: 'Animal Farm' } };
    expect(generateClaimCID(different)).not.toBe(generateClaimCID(base));
  });
});
