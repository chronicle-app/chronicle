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
 * The line a command ends with: status, subject, counts, time, destination.
 * `✓ shell · history  1,240 commands  in 1.7s  → out.json`
 *
 * When it doesn't fit, the least useful parts go first (destination,
 * written, skipped, then time), then the counts are cut; a failure count
 * always stays.
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
    ['  '],
  ];
  const counts: Segment[] = [];
  if (fields.records === 0) counts.push(['no records', t.muted]);
  for (const [type, n] of Object.entries(fields.counts)) {
    if (counts.length > 0) counts.push([` ${glyphs.bullet} `, t.muted]);
    counts.push([count(n), t.strong], [` ${plural(type, n)}`]);
  }
  const kept: Segment[] = failed
    ? [[` ${glyphs.bullet} ${count(fields.failed!)} failed`, t.danger]]
    : [];
  const parts: { [part: string]: Segment[] } = {
    skipped: fields.skipped
      ? [[` ${glyphs.bullet} ${count(fields.skipped)} skipped`, t.muted]]
      : [],
    written:
      fields.written === undefined
        ? []
        : [[` ${glyphs.bullet} ${count(fields.written)} written`, t.muted]],
    duration: [[`  in ${duration(fields.durationMs)}`, t.muted]],
    output: fields.output
      ? [
          [`  ${glyphs.arrow} `, t.muted],
          [fields.output, undefined],
        ]
      : [],
  };
  const fixed = measure(head) + measure(counts) + measure(kept);
  const total = () => fixed + Object.values(parts).reduce((n, part) => n + measure(part), 0);
  for (const part of ['output', 'written', 'skipped', 'duration']) {
    if (total() <= width) break;
    parts[part] = [];
  }
  if (fixed <= width) {
    return line(
      [
        ...head,
        ...counts,
        ...parts.skipped,
        ...kept,
        ...parts.written,
        ...parts.duration,
        ...parts.output,
      ],
      width
    );
  }
  // Still too long: cut the counts, keep the failures.
  const room = Math.max(0, width - measure(kept));
  return (
    line([...head, ...counts], room) +
    line(kept, width - Math.min(room, measure(head) + measure(counts)))
  );
}

/** A next move, dim and indented under the summary: `  stopped at --limit 100 · pass …`. */
export function hint(message: string, action: string | undefined, t: Tokens, width: number) {
  const text = action ? (message ? `${message} ${glyphs.bullet} ${action}` : action) : message;
  // A next move is worth reading whole: wrapped at spaces, not cut.
  return wrap(text, width - 2)
    .map(part => line([[`  ${part}`, t.muted]], width))
    .join('\n');
}

/** Text in lines of at most `width`, broken at spaces; a word longer than that is cut. */
export function wrap(text: string, width: number): string[] {
  if (!Number.isFinite(width) || text.length <= width) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current && current.length + 1 + word.length > width) {
      lines.push(current);
      current = '';
    }
    current = current ? `${current} ${word}` : truncate(word, Math.max(1, width));
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
