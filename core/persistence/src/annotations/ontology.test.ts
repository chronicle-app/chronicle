import { describe, expect, it } from 'vitest';
import { getAllPredicateAnnotations, getPredicateAnnotation } from './ontology.js';

describe('ontology annotations', () => {
  it('resolves cardinality from the yaml', () => {
    expect(getPredicateAnnotation('name')?.cardinality).toBe('one');
    expect(getPredicateAnnotation('genre')?.cardinality).toBe('many');
    expect(getPredicateAnnotation('author')?.cardinality).toBe('many');
  });

  it('flags entity-valued vs literal ranges', () => {
    expect(getPredicateAnnotation('name')?.isEntityRange).toBe(false); // Text
    expect(getPredicateAnnotation('genre')?.isEntityRange).toBe(false); // Text
    expect(getPredicateAnnotation('inAlbum')?.isEntityRange).toBe(true); // MusicAlbum
    expect(getPredicateAnnotation('member')?.isEntityRange).toBe(true); // Person
    expect(getPredicateAnnotation('location')?.isEntityRange).toBe(true); // Location
  });

  it('reaches predicates nested under grouping nodes', () => {
    // `genre` lives under the `characterization` group; `author` under `attribution`.
    const all = getAllPredicateAnnotations();
    expect(all.has('genre')).toBe(true);
    expect(all.has('author')).toBe(true);
    // grouping nodes themselves are not predicates
    expect(all.has('characterization')).toBe(false);
    expect(all.has('attribution')).toBe(false);
  });
});
