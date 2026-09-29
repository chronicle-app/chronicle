import chalk from 'chalk';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Loader } from '../../loader.js';
import { LoadResult, Record } from '../../types.js';
import { columnsOption, Cell, Rows } from './columns.js';

const GAP = 2;
const MAX_WIDTH = 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A date in local time to the minute: what a person scanning rows needs. */
function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const asDate = (value: Cell | undefined): Date | undefined =>
  value instanceof Date
    ? value
    : typeof value === 'string' && ISO_DATE.test(value)
      ? new Date(value)
      : undefined;

function cellText(value: Cell | undefined): string {
  if (value === undefined) return '';
  const date = asDate(value);
  if (date && !Number.isNaN(date.getTime())) return formatDate(date);
  return String(value).replaceAll(/\s+/g, ' ').trim();
}

const truncate = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;

const heading = (column: string) => column.replace(/^@/, '');

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
      if (widths.length === 1) break;
      widths.pop();
    } else {
      widths[widest] -= 1;
    }
  }
  return widths;
}

/**
 * `--loader table`: rows for reading in a terminal. Columns come from
 * `recordRow`, so bookkeeping stays out and nested nodes show their labels.
 * Columns that hold one value across every row move up into a caption, the
 * table fits the terminal, and a single record prints as a card instead.
 */
export class TableLoader extends Loader<typeof TableLoader> {
  static override source = 'table';
  static override schema = z.object({
    output: z.string().optional().describe('Output file path (default: stdout)'),
    headers: z.boolean().default(true).describe('Show column headers in table'),
    columns: columnsOption,
  });

  private rows = new Rows(this.config.columns);

  /** Whether `--columns schema` would show properties this run left out. */
  get collapsed(): boolean {
    return this.rows.collapsed;
  }

  /** Columns the terminal had no room for, known after teardown; the CLI hints at them. */
  hiddenColumns: string[] = [];

  async load(record: Record): Promise<LoadResult> {
    this.rows.add(record.data);
    return { success: true, record };
  }

  override async teardown(): Promise<void> {
    if (this.rows.rows.length === 0) return;
    const c = this.config.output ? new chalk.Instance({ level: 0 }) : chalk;
    const width = this.config.output ? Number.POSITIVE_INFINITY : process.stdout.columns || 120;
    const lines = this.rows.rows.length === 1 ? this.card(c, width) : this.table(c, width);
    const output = `${lines.join('\n')}\n`;
    if (this.config.output) writeFileSync(this.config.output, output);
    else process.stdout.write(output);
  }

  private card(c: chalk.Chalk, width: number): string[] {
    const [row] = this.rows.rows;
    const keys = this.rows.columns.filter(k => k !== '@type');
    const keyWidth = Math.max(...keys.map(k => k.length));
    const title = row.get('@type');
    return [
      ...(title === undefined ? [] : [c.bold(String(title))]),
      ...keys.map(
        key =>
          `${c.dim(key.padEnd(keyWidth))}  ${truncate(cellText(row.get(key)), width - keyWidth - GAP)}`
      ),
    ];
  }

  private table(c: chalk.Chalk, width: number): string[] {
    const { columns, rows } = this.rows;
    const texts = new Map(columns.map(column => [column, rows.map(r => cellText(r.get(column)))]));
    const constant = columns.filter(column => {
      const [first, ...rest] = texts.get(column)!;
      return first !== '' && rest.every(text => text === first);
    });
    const shown = columns.filter(column => !constant.includes(column));

    // The caption wraps between entries, each entry cut to the width.
    const lines: string[] = [];
    let line = '';
    let lineWidth = 0;
    for (const column of constant) {
      const label = column === '@type' ? '' : heading(column);
      const value = truncate(texts.get(column)![0], width - label.length - 1);
      const entry = label ? `${c.dim(label)} ${value}` : c.bold(value);
      const entryWidth = (label ? label.length + 1 : 0) + value.length;
      if (lineWidth > 0 && lineWidth + 5 + entryWidth > width) {
        lines.push(line);
        line = '';
        lineWidth = 0;
      }
      line += lineWidth > 0 ? c.dim('  ·  ') + entry : entry;
      lineWidth += (lineWidth > 0 ? 5 : 0) + entryWidth;
    }
    if (line) lines.push(line, '');
    if (shown.length === 0) return lines;

    const cells = rows.map((_, r) => shown.map(column => texts.get(column)![r]));
    const widths = fit(
      shown.map(column => heading(column)),
      cells,
      width
    );
    const numeric = shown.map(column => rows.every(r => typeof (r.get(column) ?? 0) === 'number'));
    const dated = shown.map(column => rows.some(r => asDate(r.get(column)) !== undefined));
    const cell = (text: string, i: number) => {
      const t = truncate(text, widths[i]);
      return numeric[i] ? t.padStart(widths[i]) : t.padEnd(widths[i]);
    };

    if (this.config.headers) {
      lines.push(
        join(widths.map((_, i) => c.dim(cell(heading(shown[i]), i)))),
        join(widths.map(w => c.dim('─'.repeat(w))))
      );
    }
    for (const row of cells) {
      lines.push(join(widths.map((_, i) => (dated[i] ? c.dim(cell(row[i], i)) : cell(row[i], i)))));
    }
    this.hiddenColumns = shown.slice(widths.length).map(column => heading(column));
    return lines;
  }
}
