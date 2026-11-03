/**
 * The CQL shape grammar: the traversal grammar with the
 * predicates removed. A leaf with a value constrains; a bare leaf selects —
 * so a shape is just field names and `{}` descents:
 *
 *   { name duration album:{ name year } artist:{ name } }
 *
 * The outer braces are optional. A bare `*` is the wildcard field — every stored
 * predicate on an entity, taking the same modifier and sub-shape a named edge
 * does (`*(history):{ name }`). Shapes drive the serializer: what you ask for is
 * what you get, nothing else.
 */

import { CQLParseError } from './parser.js';

export interface Shape {
  fields: ShapeField[];
}

export interface ShapeField {
  /**
   * A predicate/computed field name, or the bare `*` wildcard — an entity-level
   * selector for every stored predicate present on the node. `*` stands wholly on
   * its own (`*foo`/`foo*` are not names) and composes with the modifier and a
   * sub-shape exactly as a named edge does: `*(history):{ name @type }`.
   */
  name: string;
  children?: Shape;
  /**
   * A per-field fidelity modifier, `name(history)`: emit the predicate's
   * bitemporal runs instead of its elected current value. Only `history` is
   * recognized.
   */
  modifier?: 'history';
}

/** Parse a shape string. Throws CQLParseError with position on bad input. */
export function parseShape(source: string): Shape {
  const p = new ShapeParser(source);
  p.skipWs();
  const wrapped = p.eat('{');
  const shape = p.parseFields(wrapped ? '}' : undefined);
  if (wrapped) p.expect('}', 'to close the shape');
  p.skipWs();
  if (!p.done()) p.fail(`Unexpected '${p.peek()}'`);
  if (shape.fields.length === 0) p.fail('An empty shape selects nothing — name at least one field');
  return shape;
}

class ShapeParser {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  done(): boolean {
    return this.pos >= this.src.length;
  }

  peek(): string {
    return this.src[this.pos] ?? '';
  }

  skipWs(): void {
    while (!this.done() && /[\s,]/.test(this.peek())) this.pos++;
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

  /**
   * A field name: the bare `*` wildcard, or an identifier. A wildcard stands
   * wholly on its own — `*foo`, `foo*`, and `**` are not names, only a bare `*`
   * is (an adjacent name character on either side is the error).
   */
  parseFieldName(): string {
    if (this.eat('*')) {
      if (/[A-Za-z0-9_@*]/.test(this.peek())) {
        this.fail(`'*' is a wildcard on its own — it takes no prefix or suffix`);
      }
      return '*';
    }
    const m = /^[A-Za-z_@][A-Za-z0-9_]*/.exec(this.src.slice(this.pos));
    if (m === null) this.fail(`Expected a field name`);
    this.pos += m[0].length;
    if (this.peek() === '*') {
      this.fail(`'*' is a wildcard on its own — it takes no prefix or suffix`);
    }
    return m[0];
  }

  parseFields(terminator: '}' | undefined): Shape {
    const fields: ShapeField[] = [];
    for (;;) {
      this.skipWs();
      if (this.done() || (terminator !== undefined && this.peek() === terminator)) break;
      const field: ShapeField = { name: this.parseFieldName() };
      // Optional `(modifier)` immediately after the name, before any `:{`.
      if (this.peek() === '(') {
        this.pos++;
        this.skipWs();
        const mod = /^[A-Za-z]+/.exec(this.src.slice(this.pos));
        if (mod === null) this.fail(`Expected a modifier name in ${field.name}( … )`);
        this.pos += mod[0].length;
        if (mod[0] !== 'history') {
          this.fail(`Unknown field modifier '(${mod[0]})' — only (history) is recognized`);
        }
        this.skipWs();
        this.expect(')', `to close ${field.name}(history`);
        field.modifier = 'history';
      }
      this.skipWs();
      if (this.eat(':')) {
        this.skipWs();
        this.expect('{', `— a shape field descends with braces: ${field.name}:{ … }`);
        field.children = this.parseFields('}');
        this.expect('}', `to close ${field.name}:{ …`);
        if (field.children.fields.length === 0) {
          this.fail(`${field.name}:{ } selects nothing — name its fields or use a bare leaf`);
        }
      }
      fields.push(field);
    }
    return { fields };
  }
}

/**
 * The reference-expansion dot-paths a shape implies: every branch with
 * children names an edge the serializer must materialize before pruning.
 */
export function shapeExpandPaths(shape: Shape, prefix = ''): string[] {
  const paths: string[] = [];
  for (const field of shape.fields) {
    if (field.children === undefined) continue;
    const path = prefix === '' ? field.name : `${prefix}.${field.name}`;
    paths.push(path, ...shapeExpandPaths(field.children, path));
  }
  return paths;
}
