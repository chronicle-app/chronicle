import { describe, expect, it } from 'vitest';
import { CQLParseError, parse } from './parser.js';
import type { FieldTerm, OrTerm, ScopeTerm } from './ast.js';

const field = (q: string): FieldTerm => {
  const [term] = parse(q);
  expect(term.kind).toBe('field');
  return term as FieldTerm;
};

const scope = (q: string): ScopeTerm => {
  const [term] = parse(q);
  expect(term.kind).toBe('scope');
  return term as ScopeTerm;
};

describe('basics', () => {
  it('empty query is the whole graph', () => {
    expect(parse('')).toEqual([]);
    expect(parse('   ')).toEqual([]);
  });

  it('type is an ordinary field', () => {
    expect(parse('type:Song')).toEqual([
      {
        kind: 'field',
        field: 'type',
        predicate: { op: 'eq', values: [{ kind: 'word', value: 'Song' }] },
      },
    ]);
  });

  it('space means AND', () => {
    expect(parse('type:Song source:spotify')).toHaveLength(2);
  });

  it('comma builds a value set', () => {
    expect(field('type:Song,Album').predicate).toEqual({
      op: 'eq',
      values: [
        { kind: 'word', value: 'Song' },
        { kind: 'word', value: 'Album' },
      ],
    });
  });

  it('pipe builds OR groups of conjunctions', () => {
    const [term] = parse('type:Song | type:Album name:"X"');
    expect(term.kind).toBe('or');
    const or = term as OrTerm;
    expect(or.groups).toHaveLength(2);
    expect(or.groups[0]).toHaveLength(1);
    expect(or.groups[1]).toHaveLength(2);
  });

  it('OR keyword is the spelled-out pipe', () => {
    const [term] = parse('type:Song OR type:Album');
    expect(term.kind).toBe('or');
  });

  it('quoted text is a hybrid full-text term', () => {
    expect(parse('"nostalgia"')).toEqual([{ kind: 'text', value: 'nostalgia' }]);
    expect(parse('type:Note "memory"')[1]).toEqual({ kind: 'text', value: 'memory' });
  });

  it('bare @me is an identity constraint on the root', () => {
    expect(parse('@me')).toEqual([{ kind: 'anchor', name: 'me' }]);
  });

  it('a standalone bare word is full-text — the search box contract', () => {
    expect(parse('nostalgia')).toEqual([{ kind: 'text', value: 'nostalgia' }]);
    expect(parse('type:Book orwell')[1]).toEqual({ kind: 'text', value: 'orwell' });
    expect(parse('-noise')[0]).toEqual({ kind: 'text', value: 'noise', negated: true });
  });

  it('a digit-first bare word is full-text too', () => {
    expect(parse('1rg')).toEqual([{ kind: 'text', value: '1rg' }]);
    expect(parse('type:Collection 2024')[1]).toEqual({ kind: 'text', value: '2024' });
    expect(parse('-3d')[0]).toEqual({ kind: 'text', value: '3d', negated: true });
  });

  it('a function without a predicate still teaches', () => {
    expect(() => parse('avg(rating)')).toThrowError(/needs a predicate/);
  });
});

describe('field predicates', () => {
  it('bare colon is equals; quotes preserve text', () => {
    expect(field('name:"Dune"').predicate).toEqual({
      op: 'eq',
      values: [{ kind: 'string', value: 'Dune' }],
    });
  });

  it('comparators slot in after the colon', () => {
    expect(field('rating:>=4').predicate).toEqual({
      op: 'cmp',
      cmp: '>=',
      value: { kind: 'word', value: '4' },
    });
    expect(field('duration:<3m').predicate).toEqual({
      op: 'cmp',
      cmp: '<',
      value: { kind: 'word', value: '3m' },
    });
  });

  it('relative dates keep their sign', () => {
    expect(field('timestamp:>-7d').predicate).toEqual({
      op: 'cmp',
      cmp: '>',
      value: { kind: 'word', value: '-7d' },
    });
  });

  it('a..b is an inclusive range', () => {
    expect(field('price:10..20').predicate).toEqual({
      op: 'range',
      lo: { kind: 'word', value: '10' },
      hi: { kind: 'word', value: '20' },
    });
    expect(field('timestamp:2019..2021').predicate).toEqual({
      op: 'range',
      lo: { kind: 'word', value: '2019' },
      hi: { kind: 'word', value: '2021' },
    });
  });

  it('* is existence', () => {
    expect(field('name:*').predicate).toEqual({ op: 'exists' });
  });

  it('~ compares by meaning, bare over the whole node', () => {
    expect(parse('~"beach at sunset"')).toEqual([
      { kind: 'similar', value: { kind: 'string', value: 'beach at sunset' } },
    ]);
    expect(parse('~@note1')).toEqual([
      { kind: 'similar', value: { kind: 'anchor', name: 'note1' } },
    ]);
  });

  it('field-scoped ~ teaches the bare form', () => {
    expect(() => parse('caption:~"beach"')).toThrow(/write it bare: ~"…"/);
  });

  it('anchors are typed values', () => {
    expect(field('agent:@me').predicate).toEqual({
      op: 'eq',
      values: [{ kind: 'anchor', name: 'me' }],
    });
  });

  it('- negates the term it prefixes', () => {
    expect(field('-explicit:true').negated).toBe(true);
  });
});

describe('traversal', () => {
  it('braces descend into a referenced node', () => {
    const term = field('artist:{ name:"Björk" }');
    expect(term.subquery).toEqual([
      {
        kind: 'field',
        field: 'name',
        predicate: { op: 'eq', values: [{ kind: 'string', value: 'Björk' }] },
      },
    ]);
  });

  it('hops nest', () => {
    const outer = field('object:{ author:{ name:"Le Guin" } }');
    const inner = outer.subquery?.[0] as FieldTerm;
    expect(inner.field).toBe('author');
    expect((inner.subquery?.[0] as FieldTerm).field).toBe('name');
  });

  it('bare text inside braces is that node’s text', () => {
    expect(field('artist:{ "electronic" }').subquery).toEqual([
      { kind: 'text', value: 'electronic' },
    ]);
  });

  it('negation binds outside or inside — the classic trap, made explicit', () => {
    const none = field('-artist:{ name:"Drake" }');
    expect(none.negated).toBe(true);
    const someNot = field('artist:{ -name:"Drake" }');
    expect(someNot.negated).toBeUndefined();
    expect((someNot.subquery?.[0] as FieldTerm).negated).toBe(true);
  });

  it('edge constraints ride in parens, apart from the node sub-query', () => {
    const term = field('recipient(type:cc):{ name:"Alice" }');
    expect(term.edge).toEqual([
      {
        kind: 'field',
        field: 'type',
        predicate: { op: 'eq', values: [{ kind: 'word', value: 'cc' }] },
      },
    ]);
    expect(term.subquery).toHaveLength(1);
  });
});

describe('cardinality', () => {
  it('count compares the neighbor count', () => {
    expect(field('artist:count>1').quantifier).toEqual({ q: 'count', cmp: '>', n: 1 });
    expect(field('recipient:count>=20').quantifier).toEqual({ q: 'count', cmp: '>=', n: 20 });
  });

  it('single is count=1', () => {
    expect(field('artist:single').quantifier).toEqual({ q: 'count', cmp: '=', n: 1 });
  });

  it('some/none/every quantify a sub-query', () => {
    expect(field('recipient:none{ name:"Alice" }').quantifier).toEqual({ q: 'none' });
    expect(field('recipient:every{ "book club" }').quantifier).toEqual({ q: 'every' });
    expect(field('artist:some{ name:"Björk" }').quantifier).toEqual({ q: 'some' });
  });

  it('count composes with a sub-query', () => {
    const term = field('track:count>=20{ artist:{ name:"Bowie" } }');
    expect(term.quantifier).toEqual({ q: 'count', cmp: '>=', n: 20 });
    expect(term.subquery).toHaveLength(1);
  });

  it('count without a comparison teaches', () => {
    expect(() => parse('artist:count')).toThrowError(/count>1/);
  });
});

describe('temporal scopes', () => {
  it('during pins a window', () => {
    const s = scope('during(2019){ residence:{ name:"Berlin" } }');
    expect(s.scope).toBe('during');
    expect(s.window).toEqual({ kind: 'word', value: '2019' });
    expect(s.body).toHaveLength(1);
  });

  it('throughout and asof take windows too', () => {
    expect(scope('throughout(2020){ employer:{ name:"Acme" } }').scope).toBe('throughout');
    expect(scope('asof(2020-06){ name:"1984" }').window).toEqual({
      kind: 'word',
      value: '2020-06',
    });
  });

  it('@t makes the window travel with each outer row', () => {
    const term = field('recipient:{ during(@t){ residence:{ name:"Berlin" } } }');
    const inner = term.subquery?.[0] as ScopeTerm;
    expect(inner.window).toEqual({ kind: 'anchor', name: 't' });
  });

  it('current/past/ever need no window', () => {
    expect(scope('current{ follows:@me }').scope).toBe('current');
    expect(scope('past{ residence:{ name:"Berlin" } }').scope).toBe('past');
    expect(scope('ever{ consuming:@me }').scope).toBe('ever');
  });

  it('a field named like a scope still parses as a field', () => {
    expect(field('current:true').field).toBe('current');
  });

  it('a scope without its sub-query teaches', () => {
    expect(() => parse('during(2019)')).toThrowError(/scopes a sub-query/);
  });
});

describe('pseudo-edges and functions', () => {
  it('a pseudo-edge is an ordinary edge with an anchor sub-query', () => {
    const term = field('while:{ residence:{ name:"Paris" } }');
    expect(term.field).toBe('while');
    expect(term.subquery).toHaveLength(1);
  });

  it('the window shorthand rides the parens', () => {
    const term = field('after(2w):{ type:TravelAction }');
    expect(term.edgeValue).toEqual({ kind: 'word', value: '2w' });
    expect(term.subquery).toHaveLength(1);
  });

  it('gap spells the same window explicitly', () => {
    const term = field('after(gap:1d..1w):{ type:TravelAction }');
    expect(term.edge).toEqual([
      {
        kind: 'field',
        field: 'gap',
        predicate: {
          op: 'range',
          lo: { kind: 'word', value: '1d' },
          hi: { kind: 'word', value: '1w' },
        },
      },
    ]);
  });

  it('reducers and transforms wrap the field', () => {
    expect(field('avg(rating):>=4')).toMatchObject({ fn: 'avg', field: 'rating' });
    expect(field('year(timestamp):2019')).toMatchObject({ fn: 'year', field: 'timestamp' });
    expect(field('lower(name):"dune"')).toMatchObject({ fn: 'lower', field: 'name' });
  });
});

describe('errors that teach', () => {
  const cases: Array<[string, RegExp]> = [
    ['artist:{ name:"Björk"', /to close/],
    ['type:', /Expected a value/],
    ['name:"unterminated', /Unclosed string/],
    ['| type:Song', /nothing on its left/],
    ['type:Song |', /nothing on its right/],
    ['recipient():{ }', /Empty '\(\)'/],
  ];
  it.each(cases)('%s', (q, message) => {
    expect(() => parse(q)).toThrowError(CQLParseError);
    expect(() => parse(q)).toThrowError(message);
  });

  it('errors carry a position and an excerpt', () => {
    try {
      parse('type:Song artist:{ name:"x"');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CQLParseError);
      expect((error as CQLParseError).position).toBeGreaterThan(0);
      expect((error as CQLParseError).message).toMatch(/at \d+/);
    }
  });
});

describe('putting it together', () => {
  it('the killer trio parses to three restrictions', () => {
    const ast = parse('type:Photo timestamp:2019 ~"beach at sunset"');
    expect(ast.map(t => t.kind)).toEqual(['field', 'field', 'similar']);
  });

  it('a per-row temporal join in one line', () => {
    const ast = parse(
      'type:MessageAction agent:@me recipient:{ during(@t){ residence:{ name:"Berlin" } } } ~"missing home"'
    );
    expect(ast).toHaveLength(4);
  });

  it('deep composition stays a plain conjunction at the root', () => {
    const ast = parse(
      'type:ReadAction agent:@me while:{ residence:{ name:"Paris" } } object:{ author:{ birthPlace:{ name:"Paris" } } }'
    );
    expect(ast).toHaveLength(4);
  });
});
