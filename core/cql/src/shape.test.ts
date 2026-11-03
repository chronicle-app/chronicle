import { describe, expect, it } from 'vitest';
import { CQLParseError } from './parser.js';
import { parseShape, shapeExpandPaths } from './shape.js';

describe('shape grammar', () => {
  it('bare leaves select', () => {
    expect(parseShape('name duration')).toEqual({
      fields: [{ name: 'name' }, { name: 'duration' }],
    });
  });

  it('outer braces are optional', () => {
    expect(parseShape('{ name }')).toEqual(parseShape('name'));
  });

  it('a field descends with braces', () => {
    expect(parseShape('{ name album:{ name year } artist:{ name } }')).toEqual({
      fields: [
        { name: 'name' },
        { name: 'album', children: { fields: [{ name: 'name' }, { name: 'year' }] } },
        { name: 'artist', children: { fields: [{ name: 'name' }] } },
      ],
    });
  });

  it('descents nest', () => {
    const shape = parseShape('object:{ author:{ name } }');
    expect(shape.fields[0].children?.fields[0].children?.fields[0].name).toBe('name');
  });

  it('commas are cosmetic', () => {
    expect(parseShape('name, duration')).toEqual(parseShape('name duration'));
  });

  it('expand paths name every branch', () => {
    expect(shapeExpandPaths(parseShape('name object:{ author:{ name } } artist:{ name }'))).toEqual(
      ['object', 'object.author', 'artist']
    );
  });

  it.each([
    ['', /empty shape/],
    ['{ }', /empty shape/],
    ['album:{ }', /selects nothing/],
    ['album:name', /descends with braces/],
    ['{ name', /to close the shape/],
  ])('teaches on %j', (src, message) => {
    expect(() => parseShape(src)).toThrowError(CQLParseError);
    expect(() => parseShape(src)).toThrowError(message);
  });

  it('a field carries a (history) modifier', () => {
    expect(parseShape('name(history)')).toEqual({
      fields: [{ name: 'name', modifier: 'history' }],
    });
  });

  it('a (history) field still descends with a sub-shape', () => {
    expect(parseShape('partOf(history):{ name }')).toEqual({
      fields: [{ name: 'partOf', modifier: 'history', children: { fields: [{ name: 'name' }] } }],
    });
  });

  it('a modifier mixes with plain fields in a shape', () => {
    expect(parseShape('{ name(history) duration }')).toEqual({
      fields: [{ name: 'name', modifier: 'history' }, { name: 'duration' }],
    });
  });

  it('whitespace inside the parens is cosmetic', () => {
    expect(parseShape('name( history )')).toEqual(parseShape('name(history)'));
  });

  it('the modifier leaves shapeExpandPaths unchanged', () => {
    expect(shapeExpandPaths(parseShape('partOf(history):{ name } name(history)'))).toEqual([
      'partOf',
    ]);
  });

  it.each([
    ['name(future)', /Unknown field modifier '\(future\)'/],
    ['name(HISTORY)', /Unknown field modifier '\(HISTORY\)'/],
    ['name()', /Expected a modifier name/],
    ['name(history', /to close name\(history/],
  ])('rejects %j', (src, message) => {
    expect(() => parseShape(src)).toThrowError(CQLParseError);
    expect(() => parseShape(src)).toThrowError(message);
  });

  it('a bare * is a wildcard field', () => {
    expect(parseShape('*')).toEqual({ fields: [{ name: '*' }] });
  });

  it('the wildcard carries the (history) modifier', () => {
    expect(parseShape('*(history)')).toEqual({ fields: [{ name: '*', modifier: 'history' }] });
  });

  it('the wildcard descends with a sub-shape', () => {
    expect(parseShape('*(history):{ name @type @iri }')).toEqual({
      fields: [
        {
          name: '*',
          modifier: 'history',
          children: { fields: [{ name: 'name' }, { name: '@type' }, { name: '@iri' }] },
        },
      ],
    });
  });

  it('the wildcard mixes with named fields', () => {
    expect(parseShape('{ name * }')).toEqual({
      fields: [{ name: 'name' }, { name: '*' }],
    });
  });

  it.each([
    ['*foo', /wildcard on its own/],
    ['foo*', /wildcard on its own/],
    ['**', /wildcard on its own/],
    ['*name', /wildcard on its own/],
  ])('rejects %j', (src, message) => {
    expect(() => parseShape(src)).toThrowError(CQLParseError);
    expect(() => parseShape(src)).toThrowError(message);
  });
});
