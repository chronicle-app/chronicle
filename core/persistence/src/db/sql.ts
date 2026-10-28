/**
 * A SQL statement or fragment: its text, with a `?` for each bound value, and
 * those values in order. Built by {@link sql}; run through a {@link Db}.
 */
export interface Sql {
  readonly text: string;
  readonly params: readonly unknown[];
}

class Fragment implements Sql {
  constructor(
    readonly text: string,
    readonly params: readonly unknown[]
  ) {}
}

/** Append `value` to a statement: its text is returned, its bound values pushed onto `params`. */
function splice(value: unknown, params: unknown[]): string {
  if (value instanceof Fragment) {
    for (const param of value.params) params.push(param);
    return value.text;
  }
  if (Array.isArray(value)) return `(${value.map(item => splice(item, params)).join(', ')})`;
  if (value === undefined) return '';
  params.push(value);
  return '?';
}

/**
 * SQL from a template. Each interpolated value is bound as a parameter, except
 * that a fragment from `sql` is spliced in with its own values, an array
 * becomes a parenthesized list of its items (`id IN ${ids}`), and `undefined`
 * adds nothing.
 */
function build(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  const params: unknown[] = [];
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += splice(values[i], params) + strings[i + 1];
  return new Fragment(text, params);
}

/** Text spliced in as it is, with no values: for SQL that's built from trusted parts. */
function raw(text: string): Sql {
  return new Fragment(text, []);
}

/** The fragments one after another, with `separator` between each two. */
function join(parts: readonly Sql[], separator: Sql): Sql {
  const params: unknown[] = [];
  const text = parts
    .map((part, i) => (i > 0 ? splice(separator, params) : '') + splice(part, params))
    .join('');
  return new Fragment(text, params);
}

export const sql = Object.assign(build, { raw, join });
