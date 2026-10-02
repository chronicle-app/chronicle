import type { SummaryFields } from '@chronicle.app/logging';
import { count, duration, plural, truncate } from './format.js';
import { glyphs } from './glyphs.js';
import type { Style, Tokens } from './tokens.js';

/** A run of text and the style it prints in. */
export type Segment = [text: string, style?: Style];

/** Segments as one line of at most `width` visible characters, styled after cutting. */
export function line(segments: Segment[], width: number): string {
  let left = width;
  let out = '';
  for (const [text, style] of segments) {
    if (left <= 0) break;
    const cut = text.length > left ? truncate(text, left) : text;
    left -= cut.length;
    out += style ? style(cut) : cut;
  }
  return out;
}

/** A finished run's totals: what a `summary` event carries in its fields. */
export type { SummaryFields } from '@chronicle.app/logging';

const measure = (segments: Segment[]) => segments.reduce((n, [text]) => n + text.length, 0);

/**
 * A run's summary, for a person: the outcome on the first line (status,
 * title, time, where the records went), then a line per record kind, counts
 * aligned so they scan as a column, and lines for anything failed, skipped,
 * or written.
 *
 *   ✓ github · api  in 4.6s  → out.json
 *       2 stars
 *       3 pull requests
 *       1 commit
 */
export function summary(
  fields: SummaryFields,
  t: Tokens,
  width: number,
  { status = true }: { status?: boolean } = {}
): string {
  const failed = (fields.failed ?? 0) > 0;
  const head: Segment[] = [
    ...(status
      ? ([
          [failed ? glyphs.failure : glyphs.success, failed ? t.danger : t.success],
          [' '],
        ] as Segment[])
      : []),
    [fields.title, t.strong],
    [`  in ${duration(fields.durationMs)}`, t.muted],
    ...(fields.output
      ? ([
          [`  ${glyphs.arrow} `, t.muted],
          [fields.output, undefined],
        ] as Segment[])
      : []),
  ];
  const rows: (readonly [n: number | undefined, label: string, style: Segment[1]])[] = [
    ...(fields.records === 0 ? [[undefined, 'no records', t.muted] as const] : []),
    ...Object.entries(fields.counts).map(
      ([type, n]) => [n, plural(type.replaceAll('-', ' '), n), undefined] as const
    ),
    ...(failed ? [[fields.failed!, 'failed', t.danger] as const] : []),
    ...(fields.skipped ? [[fields.skipped, 'skipped', t.muted] as const] : []),
    ...(fields.written === undefined ? [] : [[fields.written, 'written', t.muted] as const]),
  ];
  const digits = Math.max(0, ...rows.map(([n]) => (n === undefined ? 0 : count(n).length)));
  return [
    line(head, width),
    ...rows.map(([n, label, style]) =>
      line(
        [
          ['    '],
          ...(n === undefined
            ? []
            : ([[count(n).padStart(digits), style ?? t.strong], [' ']] as Segment[])),
          [label, style],
        ],
        width
      )
    ),
  ].join('\n');
}

/**
 * What to do next, under the line it follows: one `↳` step per line of the
 * message and action, each a short instruction. A step that ends in a command
 * (`See its kinds: \`chronicle extract github --list-types\``) puts the
 * command on a line of its own, indented, to read and copy whole.
 *
 *   ↳ See its kinds:
 *       chronicle extract github --list-types
 */
export function hint(message: string, action: string | undefined, t: Tokens, width: number) {
  const steps = [message, ...(action ?? '').split('\n')].filter(step => step.trim() !== '');
  const lines: string[] = [];
  for (const step of steps) {
    const ending = step.match(/^(.*?):?\s*`([^`]+)`$/s);
    const [prose, command] = ending ? [ending[1].trim(), ending[2]] : [step, undefined];
    if (prose) {
      // Wrapped at spaces, continued under its text rather than its arrow.
      for (const [i, part] of wrap(command ? `${prose}:` : prose, width - 4).entries())
        lines.push(t.muted(i === 0 ? `  ${glyphs.child} ` : '    ') + codeSpans(part, t));
    }
    if (command) {
      // Never cut: a command prints whole, and the terminal wraps it.
      lines.push(
        prose
          ? `      ${t.command(command)}`
          : `${t.muted(`  ${glyphs.child} `)}${t.command(command)}`
      );
    }
  }
  return lines.join('\n');
}

/** Text with each `code span` in the code style, the rest muted. */
function codeSpans(text: string, t: Tokens): string {
  return text
    .split(/(`[^`]*`)/)
    .map(piece =>
      piece.startsWith('`') && piece.endsWith('`') && piece.length > 1
        ? t.code(piece.slice(1, -1))
        : piece && t.muted(piece)
    )
    .join('');
}

/**
 * Text in lines of at most `width`, broken at spaces. A `code span` is never
 * broken or cut, since a command split across lines can't be copied: it gets
 * a line of its own, even one wider than `width`. Any other word longer than
 * the width is cut.
 */
export function wrap(text: string, width: number): string[] {
  if (!Number.isFinite(width) || text.length <= width) return [text];
  const words = text.match(/`[^`]*`\S*|\S+/g) ?? [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = '';
    }
    const whole = word.startsWith('`') ? word : truncate(word, Math.max(1, width));
    current = current ? `${current} ${word}` : whole;
  }
  if (current) lines.push(current);
  return lines;
}

/** A section title. Emphasis only: no rules, no boxes. */
export const heading = (text: string, t: Tokens, width: number) => line([[text, t.strong]], width);

/** Items one per line under a bullet. */
export const list = (items: string[], t: Tokens, width: number) =>
  items.map(item =>
    line(
      [
        [`  ${glyphs.bullet} `, t.muted],
        [item, undefined],
      ],
      width
    )
  );

/**
 * Label/value entries on as few lines as fit, `  ·  ` between them, each cut
 * to the width. An entry without a label is a title and prints strong.
 */
export function caption(entries: [label: string, value: string][], t: Tokens, width: number) {
  const lines: string[] = [];
  const separator = `  ${glyphs.bullet}  `;
  let current = '';
  let used = 0;
  for (const [label, text] of entries) {
    const value = truncate(text, width - (label ? label.length + 1 : 0));
    const entry = label ? `${t.muted(label)} ${value}` : t.strong(value);
    const entryWidth = (label ? label.length + 1 : 0) + value.length;
    if (used > 0 && used + separator.length + entryWidth > width) {
      lines.push(current);
      current = '';
      used = 0;
    }
    current += used > 0 ? t.muted(separator) + entry : entry;
    used += (used > 0 ? separator.length : 0) + entryWidth;
  }
  if (current) lines.push(current);
  return lines;
}

/** One record's keys and values, a title above. */
export function card(
  title: string | undefined,
  entries: [key: string, value: string][],
  t: Tokens,
  width: number
) {
  const keyWidth = Math.min(Math.max(0, ...entries.map(([key]) => key.length)), width);
  return [
    ...(title === undefined ? [] : [t.strong(truncate(title, width))]),
    ...entries.map(([key, value]) => {
      const valueWidth = width - keyWidth - GAP;
      return valueWidth > 0
        ? `${t.muted(truncate(key, keyWidth).padEnd(keyWidth))}${' '.repeat(GAP)}${truncate(value, valueWidth)}`
        : t.muted(truncate(key, width));
    }),
  ];
}

const GAP = 2;
const MAX_WIDTH = 60;

const join = (parts: string[]) => parts.join(' '.repeat(GAP)).trimEnd();

/**
 * Column widths that fit `width`: the widest column gives way first, down to
 * its heading; columns that still don't fit are dropped from the right.
 */
function fit(headings: string[], cells: string[][], width: number) {
  const floors = headings.map(h => Math.max(h.length, 6));
  const widths = headings.map((h, i) =>
    Math.min(MAX_WIDTH, Math.max(h.length, ...cells.map(row => row[i].length)))
  );
  const total = () => widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1);
  while (total() > width) {
    let widest = -1;
    for (const [i, w] of widths.entries()) {
      if (w > floors[i] && (widest < 0 || w > widths[widest])) widest = i;
    }
    if (widest < 0) {
      if (widths.length === 1) {
        widths[0] = Math.max(1, width);
        break;
      }
      widths.pop();
    } else {
      widths[widest] -= 1;
    }
  }
  return widths;
}

export interface TableInput {
  headings: string[];
  /** Cell text, one array per row, one entry per heading. */
  cells: string[][];
  /** Columns aligned right. */
  numeric?: boolean[];
  /** Columns printed muted, such as dates. */
  muted?: boolean[];
  /** A heading row and rule. Default true. */
  headers?: boolean;
}

/**
 * Rows fitted to `width`: the widest column gives way first, and columns that
 * still don't fit are dropped from the right; `hidden` names them.
 */
export function table(input: TableInput, t: Tokens, width: number) {
  const { headings, cells, numeric = [], muted = [], headers = true } = input;
  const widths = fit(headings, cells, width);
  const cell = (text: string, i: number) => {
    const cut = truncate(text, widths[i]);
    return numeric[i] ? cut.padStart(widths[i]) : cut.padEnd(widths[i]);
  };
  const lines: string[] = [];
  if (headers) {
    lines.push(
      join(widths.map((_, i) => t.muted(cell(headings[i], i)))),
      join(widths.map(w => t.muted(glyphs.rule.repeat(w))))
    );
  }
  for (const row of cells) {
    lines.push(join(widths.map((_, i) => (muted[i] ? t.muted(cell(row[i], i)) : cell(row[i], i)))));
  }
  return { lines, hidden: headings.slice(widths.length) };
}
