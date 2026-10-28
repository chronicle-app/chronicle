import { describe, expect, it } from 'vitest';
import {
  getLifecycleFacet,
  getPersistenceClass,
  isLifecycleFacet,
  isOccurrenceType,
} from './actionTypes.js';

describe('persistence class', () => {
  it('classifies a lifecycle-facet (date) predicate', () => {
    expect(getPersistenceClass('datePublished')).toBe('lifecycle-facet');
    expect(getPersistenceClass('birthDate')).toBe('lifecycle-facet');
  });

  it("keeps an occurrence's role fact a plain relation edge, not a lifecycle facet", () => {
    // only dates ride occurrences; publisher stays an edge (its Organization range)
    expect(getPersistenceClass('publisher')).toBe('relation');
    expect(isLifecycleFacet('publisher')).toBe(false);
  });

  it('classifies a reaction special predicate', () => {
    expect(getPersistenceClass('liked')).toBe('special');
  });

  it('derives relation vs attribute from the ontology range', () => {
    expect(getPersistenceClass('author')).toBe('relation'); // entity range (Agent)
    expect(getPersistenceClass('name')).toBe('attribute'); // literal range (Text)
  });

  it('derives metric and identity from annotations', () => {
    expect(getPersistenceClass('heartRate')).toBe('metric');
    expect(getPersistenceClass('sameAs')).toBe('identity');
  });

  it('defaults an unknown predicate to attribute', () => {
    expect(getPersistenceClass('notARealPredicate')).toBe('attribute');
  });
});

describe('lifecycle facets', () => {
  it('maps a date to its occurrence type (no location facets)', () => {
    expect(getLifecycleFacet('datePublished')).toEqual({ occurrence: 'PublishAction' });
    expect(getLifecycleFacet('birthDate')).toEqual({ occurrence: 'BirthAction' });
  });

  it('isLifecycleFacet guards non-dates', () => {
    expect(isLifecycleFacet('datePublished')).toBe(true);
    expect(isLifecycleFacet('name')).toBe(false);
    expect(isLifecycleFacet('birthPlace')).toBe(false); // a place, not a date
    expect(getLifecycleFacet('name')).toBeUndefined();
  });
});

describe('occurrence types', () => {
  it('recognizes the reused action types as agentless occurrences', () => {
    expect(isOccurrenceType('PublishAction')).toBe(true);
    expect(isOccurrenceType('BirthAction')).toBe(true);
    expect(isOccurrenceType('CreateAction')).toBe(true);
    expect(isOccurrenceType('DeathAction')).toBe(true);
  });

  it('an agent-bearing activity is not an occurrence', () => {
    expect(isOccurrenceType('MessageAction')).toBe(false);
    expect(isOccurrenceType('LikeAction')).toBe(false);
  });
});

// These expectations preserve the existing fold contract across registry generation.
describe('generated action effects', () => {
  it('preserves all standing-run boundaries, including the likes/liked mapping', async () => {
    const { getSpecialPropertyDefs } = await import('./actionTypes.js');
    expect(
      getSpecialPropertyDefs()
        .map(def => ({
          predicate: def.predicate,
          openers: [...def.openers].sort(),
          closers: [...def.closers].sort(),
        }))
        .sort((a, b) => a.predicate.localeCompare(b.predicate))
    ).toEqual([{ predicate: 'liked', openers: ['LikeAction'], closers: ['UnlikeAction'] }]);
  });
});
