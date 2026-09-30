import { writeFileSync } from 'node:fs';
import {
  Loader,
  Rows,
  columnsOption,
  z,
  type Cell,
  type LoadResult,
  type Record,
} from '@chronicle.app/etl';
import { caption, card, date, table, tokens, plainTokens, type Tokens } from '../output/index.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const asDate = (value: Cell | undefined): Date | undefined =>
  value instanceof Date
    ? value
    : typeof value === 'string' && ISO_DATE.test(value)
      ? new Date(value)
      : undefined;

function cellText(value: Cell | undefined): string {
  if (value === undefined) return '';
  const when = asDate(value);
  if (when && !Number.isNaN(when.getTime())) return date(when);
  return String(value).replaceAll(/\s+/g, ' ').trim();
}

const heading = (column: string) => column.replace(/^@/, '');

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
    const t = this.config.output ? plainTokens : tokens({ stream: 'stdout' });
    const width = this.config.output ? Number.POSITIVE_INFINITY : process.stdout.columns || 120;
    const lines = this.rows.rows.length === 1 ? this.card(t, width) : this.table(t, width);
    const output = `${lines.join('\n')}\n`;
    if (this.config.output) writeFileSync(this.config.output, output);
    else process.stdout.write(output);
  }

  private card(t: Tokens, width: number): string[] {
    const [row] = this.rows.rows;
    const title = row.get('@type');
    const keys = this.rows.columns.filter(k => k !== '@type');
    return card(
      title === undefined ? undefined : String(title),
      keys.map(key => [key, cellText(row.get(key))]),
      t,
      width
    );
  }

  private table(t: Tokens, width: number): string[] {
    const { columns, rows } = this.rows;
    const texts = new Map(columns.map(column => [column, rows.map(r => cellText(r.get(column)))]));
    const constant = columns.filter(column => {
      const [first, ...rest] = texts.get(column)!;
      return first !== '' && rest.every(text => text === first);
    });
    const shown = columns.filter(column => !constant.includes(column));

    const lines = caption(
      constant.map(column => [column === '@type' ? '' : heading(column), texts.get(column)![0]]),
      t,
      width
    );
    if (lines.length > 0) lines.push('');
    if (shown.length === 0) return lines;

    const body = table(
      {
        headings: shown.map(column => heading(column)),
        cells: rows.map((_, r) => shown.map(column => texts.get(column)![r])),
        numeric: shown.map(column => rows.every(r => typeof (r.get(column) ?? 0) === 'number')),
        muted: shown.map(column => rows.some(r => asDate(r.get(column)) !== undefined)),
        headers: this.config.headers,
      },
      t,
      width
    );
    this.hiddenColumns = body.hidden;
    return [...lines, ...body.lines];
  }
}
