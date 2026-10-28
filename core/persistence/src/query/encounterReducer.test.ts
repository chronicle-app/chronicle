/**
 * Reducers over the encounter log: `first(encountered)` /
 * `last(interactedWith)` fold an entity's encounter timestamps with MIN/MAX
 * before comparing, with the same granularity rounding as written dates.
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@chronicle.app/cql';
import { lowerQuery } from './cql.js';
import { UnsupportedConstraintError } from './evaluate.js';

describe('first/last over the encounter log', () => {
  it('reducers outside the encounter log still teach', async () => {
    expect(() => lowerQuery(parse('avg(rating):>=4'))).toThrow(UnsupportedConstraintError);
    expect(() => lowerQuery(parse('first(timestamp):<2020'))).toThrow(/encounter log/);
    expect(() => lowerQuery(parse('first(encountered):{ name:"X" }'))).toThrow(/compares a time/);
  });
});
