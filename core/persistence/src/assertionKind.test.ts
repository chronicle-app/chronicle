import { describe, expect, it } from 'vitest';
import { readAssertionKind } from './assertionKind.js';

describe('readAssertionKind', () => {
  it('defaults to assert when no @kind marker is present', () => {
    expect(readAssertionKind({ '@type': 'ReadAction' })).toBe('assert');
  });

  it('reads restated and confirm markers', () => {
    expect(readAssertionKind({ '@kind': 'restated' })).toBe('restated');
    expect(readAssertionKind({ '@kind': 'confirm', claim: 'bafy…' })).toBe('confirm');
  });

  it('throws on an unrecognized @kind marker', () => {
    expect(() => readAssertionKind({ '@kind': 'retract' })).toThrow(/Unknown assertion @kind/);
  });
});
