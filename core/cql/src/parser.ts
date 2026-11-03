/**
 * The CQL parser: scannerless recursive descent over the terse
 * grammar. Space is AND, `,`/`|` are OR, `-` negates the term it prefixes,
 * `{}` descends into a referenced node, `()` constrains the edge to it, and
 * temporal scopes (`during(…){…}`, `current{…}`, `asof(…){…}`) wrap sub-queries.
 *
 * The parser is pure grammar: it never consults the schema. Field-name
 * validation (with did-you-mean suggestions) is the compiler's
 * vocabulary check, where pseudo-edges and declared inverses are known.
 */

import type {
  FieldTerm,
  TextTerm,
  Quantifier,
  Query,
  ScalarValue,
  ScopeTerm,
  Term,
  ValuePredicate,
} from './ast.js';

export class CQLParseError extends Error {
  constructor(
    message: string,
    readonly position: number,
    readonly source: string
  ) {
    super(`${message} (at ${describePosition(source, position)})`);
    this.name = 'CQLParseError';
  }
}

function describePosition(source: string, position: number): string {
  const start = Math.max(0, position - 12);
  const excerpt = source.slice(start, position + 12).trim();
  return `${position}: …${excerpt}…`;
}

const SCOPES_WITH_WINDOW = new Set(['during', 'throughout', 'asof']);
const SCOPES_BARE = new Set(['current', 'past', 'ever']);
const QUANT_WORDS = new Set(['some', 'none', 'every']);

/** Characters that end a bare word: whitespace and structure. */
const WORD_STOP = new Set([' ', '\t', '\n', '\r', '{', '}', '(', ')', '|', ',', ':', '"']);

/** Parse a CQL query string into its AST. Throws CQLParseError. */
export function parse(source: string): Query {
  const p = new Parser(source);
  const query = p.parseQuery();
  p.skipWs();
  if (!p.done()) p.fail(`Unexpected '${p.peek()}'`);
  return query;
}

class Parser {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  // --- cursor ---------------------------------------------------------------

  done(): boolean {
    return this.pos >= this.src.length;
  }

  peek(offset = 0): string {
    return this.src[this.pos + offset] ?? '';
  }

  skipWs(): void {
    while (!this.done() && /\s/.test(this.peek())) this.pos++;
  }

  eat(ch: string): boolean {
    if (this.src.startsWith(ch, this.pos)) {
      this.pos += ch.length;
      return true;
    }
    return false;
  }

  expect(ch: string, what: string): void {
    if (!this.eat(ch)) this.fail(`Expected '${ch}' ${what}`);
  }

  fail(message: string): never {
    throw new CQLParseError(message, this.pos, this.src);
  }

  // --- grammar --------------------------------------------------------------

  /** Terms until `terminator` (or end). `|` splits alternatives into OrTerm. */
  parseQuery(terminator?: '}' | ')'): Query {
    const groups: Query[] = [];
    let group: Term[] = [];
    for (;;) {
      this.skipWs();
      if (this.done() || (terminator !== undefined && this.peek() === terminator)) break;
      if (this.eat('|') || this.eatWord('OR')) {
        if (group.length === 0) this.fail(`'|' with nothing on its left`);
        groups.push(group);
        group = [];
        continue;
      }
      group.push(this.parseTerm());
    }
    if (groups.length === 0) return group;
    if (group.length === 0) this.fail(`'|' with nothing on its right`);
    groups.push(group);
    return [{ kind: 'or', groups }];
  }

  private eatWord(word: string): boolean {
    if (
      this.src.startsWith(word, this.pos) &&
      (this.pos + word.length === this.src.length || /\s/.test(this.peek(word.length)))
    ) {
      this.pos += word.length;
      return true;
    }
    return false;
  }

  parseTerm(): Term {
    if (this.eat('-')) {
      const term = this.parseTerm();
      if (term.kind === 'or') this.fail(`'-' cannot negate an OR group`);
      term.negated = true;
      return term;
    }
    if (this.peek() === '"') {
      return { kind: 'text', value: this.readString() };
    }
    if (this.eat('~')) {
      return { kind: 'similar', value: this.readValue(`a value after '~'`) };
    }
    if (this.peek() === '@') {
      this.pos++;
      const name = this.readIdent('anchor name after "@"');
      return { kind: 'anchor', name };
    }
    // A word that starts with a digit can never be a field name, so it is
    // bare text: `1rg`, `2024`, `3d` search the node's text like any word.
    if (/[0-9]/.test(this.peek())) {
      return { kind: 'text', value: this.readWord('a search term') };
    }
    const start = this.pos;
    const ident = this.readIdent('a field name');
    this.skipWs0();

    // Temporal scopes: during(2019){…}, asof(@t){…}, current{…}.
    if (SCOPES_WITH_WINDOW.has(ident) && this.peek() === '(') {
      this.pos++; // (
      this.skipWs();
      const window = this.readValue(`a window inside ${ident}(…)`);
      this.skipWs();
      this.expect(')', `to close ${ident}(…)`);
      this.skipWs();
      this.expect('{', `— ${ident}(…) scopes a sub-query: ${ident}(…){ … }`);
      const body = this.parseQuery('}');
      this.expect('}', `to close ${ident}(…){ …`);
      return { kind: 'scope', scope: ident as ScopeTerm['scope'], window, body };
    }
    if (SCOPES_BARE.has(ident) && this.peek() === '{') {
      this.pos++; // {
      const body = this.parseQuery('}');
      this.expect('}', `to close ${ident}{ …`);
      return { kind: 'scope', scope: ident as ScopeTerm['scope'], body };
    }

    return this.parseFieldTail(ident, start);
  }

  /** The rest of a field term (or a bare-word text term), after its identifier. */
  private parseFieldTail(ident: string, start: number): FieldTerm | TextTerm {
    const term: FieldTerm = { kind: 'field', field: ident };

    // `(` right after the name: either a function application (`avg(rating)`,
    // single plain identifier inside) or edge constraints (`recipient(type:cc)`,
    // `after(2w)` — anything else).
    if (this.peek() === '(') {
      this.pos++;
      this.skipWs();
      const inner = this.tryReadFnArg();
      if (inner !== undefined) {
        term.fn = ident;
        term.field = inner;
      } else if (this.looksLikeBareEdgeValue()) {
        term.edgeValue = this.readValue('an edge window');
        this.skipWs();
        this.expect(')', `to close ${ident}(…)`);
      } else {
        term.edge = this.parseQuery(')');
        this.expect(')', `to close ${ident}(…)`);
        if (term.edge.length === 0) this.fail(`Empty '()' after '${ident}'`);
      }
    }

    this.skipWs0();
    if (!this.eat(':')) {
      if (term.fn !== undefined || term.edge !== undefined || term.edgeValue !== undefined) {
        this.pos = start;
        this.fail(`'${ident}(…)' needs a predicate — e.g. avg(rating):>=4`);
      }
      // A standalone bare word is full-text over the node — the search box's
      // most common input, and what the v1 grammar always did.
      return { kind: 'text', value: ident };
    }

    // Cardinality prefix: some/none/every{…}, single, count<op>N.
    const quant = this.tryReadQuantifier();
    if (quant !== undefined) {
      term.quantifier = quant;
      this.skipWs0();
      if (this.peek() === '{') {
        this.pos++;
        term.subquery = this.parseQuery('}');
        this.expect('}', `to close ${term.field}:…{ …`);
      }
      return term;
    }

    // Traversal without predicate: field:{ … }
    if (this.peek() === '{') {
      this.pos++;
      term.subquery = this.parseQuery('}');
      this.expect('}', `to close ${term.field}:{ …`);
      return term;
    }

    term.predicate = this.readValuePredicate(term.field);
    return term;
  }

  /** Inside `(` — a single plain identifier followed by `)` is a fn argument. */
  private tryReadFnArg(): string | undefined {
    const save = this.pos;
    const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(this.src.slice(this.pos));
    if (m) {
      this.pos += m[0].length;
      this.skipWs();
      if (this.eat(')')) return m[0];
    }
    this.pos = save;
    return undefined;
  }

  /** Inside `(` — a single valueish token (no `:`) up to `)`: `after(2w)`. */
  private looksLikeBareEdgeValue(): boolean {
    const rest = this.src.slice(this.pos);
    const close = rest.indexOf(')');
    if (close === -1) return false;
    const inner = rest.slice(0, close);
    return inner.length > 0 && !/[:{}("]/.test(inner) && !/\s\S/.test(inner.trim());
  }

  private tryReadQuantifier(): Quantifier | undefined {
    const save = this.pos;
    const m = /^[a-z]+/.exec(this.src.slice(this.pos));
    if (!m) return undefined;
    const word = m[0];
    if (word === 'single') {
      this.pos += word.length;
      return { q: 'count', cmp: '=', n: 1 };
    }
    if (word === 'count') {
      this.pos += word.length;
      const cm = /^(>=|<=|=|>|<)(\d+)/.exec(this.src.slice(this.pos));
      if (!cm) this.fail(`'count' needs a comparison: count>1, count=2, count>=20`);
      this.pos += cm[0].length;
      return { q: 'count', cmp: cm[1] as '=' | '>' | '>=' | '<' | '<=', n: Number(cm[2]) };
    }
    if (QUANT_WORDS.has(word) && this.peek(word.length) === '{') {
      this.pos += word.length;
      return { q: word as 'some' | 'none' | 'every' };
    }
    this.pos = save;
    return undefined;
  }

  private readValuePredicate(field: string): ValuePredicate {
    if (this.eat('*')) return { op: 'exists' };
    if (this.peek() === '~') {
      this.fail(
        `'~' ranks whole entities, not a field — write it bare: ~"…" instead of ${field}:~"…"`
      );
    }
    const cm = /^(>=|<=|>|<)/.exec(this.src.slice(this.pos));
    if (cm) {
      this.pos += cm[0].length;
      const value = this.readValue(`a value after '${field}:${cm[0]}'`);
      return { op: 'cmp', cmp: cm[0] as '>' | '>=' | '<' | '<=', value };
    }
    const first = this.readValue(`a value after '${field}:'`);
    // Range: a bare word containing '..' (10..20, 2019..2021, 1d..1w).
    if (first.kind === 'word' && first.value.includes('..')) {
      const [lo, hi] = splitRange(first.value, this);
      return { op: 'range', lo, hi };
    }
    const values: ScalarValue[] = [first];
    while (this.peek() === ',') {
      this.pos++;
      this.skipWs();
      values.push(this.readValue(`a value after ','`));
    }
    return { op: 'eq', values };
  }

  // --- tokens ---------------------------------------------------------------

  private readIdent(what: string): string {
    const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(this.src.slice(this.pos));
    if (!m) this.fail(`Expected ${what}`);
    this.pos += m[0].length;
    return m[0];
  }

  readValue(what: string): ScalarValue {
    if (this.peek() === '"') return { kind: 'string', value: this.readString() };
    if (this.peek() === '@') {
      this.pos++;
      return { kind: 'anchor', name: this.readIdent('an anchor name after "@"') };
    }
    return { kind: 'word', value: this.readWord(what) };
  }

  /** A bare word: everything up to whitespace or structure. */
  private readWord(what: string): string {
    let out = '';
    while (!this.done() && !WORD_STOP.has(this.peek())) out += this.src[this.pos++];
    if (out === '') this.fail(`Expected ${what}`);
    return out;
  }

  private readString(): string {
    this.expect('"', 'to open a string');
    let out = '';
    for (;;) {
      if (this.done()) this.fail(`Unclosed string`);
      const ch = this.src[this.pos++];
      if (ch === '"') return out;
      if (ch === '\\' && !this.done()) {
        out += this.src[this.pos++];
        continue;
      }
      out += ch;
    }
  }

  /** Skip nothing — named for symmetry where whitespace must NOT intervene. */
  private skipWs0(): void {
    // `artist :{…}` and `artist: {…}` both read naturally; the grammar is
    // whitespace-tolerant around ':' and '{'.
    this.skipWs();
  }
}

function splitRange(raw: string, p: Parser): [ScalarValue, ScalarValue] {
  const i = raw.indexOf('..');
  const lo = raw.slice(0, i);
  const hi = raw.slice(i + 2);
  if (lo === '' || hi === '') p.fail(`A range needs both ends: lo..hi`);
  return [
    { kind: 'word', value: lo },
    { kind: 'word', value: hi },
  ];
}
