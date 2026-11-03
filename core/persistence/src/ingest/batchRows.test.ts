import { describe, expect, it } from 'vitest';
import { generateAssertionBodyCID } from '../cid/assertionCid.js';
import { EnvelopeError } from './envelope.js';
import { prepareEnvelope } from './batchRows.js';

describe('prepareEnvelope — column derivation failures stay EnvelopeError', () => {
  it('a hash-valid body with no derivable keyset throws EnvelopeError, not a raw Error', () => {
    // Structurally sound, hash-valid (its cid is the real content hash of its
    // canonical bytes), but carries no `@key` — replication skips Zod
    // re-validation (the hash is the only gate), so nothing upstream rules a
    // body like this out before it reaches column derivation.
    // deriveAssertionColumns → extractEntityKeysets → ownKeysets throws a plain
    // Error for "no @key" identity failures; prepareEnvelope must still keep
    // its documented "throws EnvelopeError on any failure" contract.
    const body = {
      '@type': 'ReadAction',
      source: 'test',
      sourceId: 'no-keyset',
      timestamp: '2023-01-01T00:00:00Z',
    };
    const { cid, canonicalBody } = generateAssertionBodyCID(body);

    expect(() =>
      prepareEnvelope({ cid, kind: 'assert', body: canonicalBody }, { verifyHash: true })
    ).toThrow(EnvelopeError);
  });

  it('a well-formed body still derives columns normally', () => {
    const body = {
      '@type': 'ReadAction',
      source: 'test',
      sourceId: 'ok',
      timestamp: '2023-01-01T00:00:00Z',
      '@assertedAt': '2023-01-01T00:00:00Z',
      '@key': ['source', 'sourceId'],
    };
    const { cid, canonicalBody } = generateAssertionBodyCID(body);

    const prepared = prepareEnvelope(
      { cid, kind: 'assert', body: canonicalBody },
      { verifyHash: true }
    );
    expect(prepared.cid).toBe(cid);
    expect(prepared.kind).toBe('assert');
  });
});
