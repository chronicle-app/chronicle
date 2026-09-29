import chalk from 'chalk';
import { nodeLabel, type RunLog } from '@chronicle.app/etl';

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const BAR = 24;
const SWEEP = 6;
const TICK = 80;

type Style = (text: string) => string;
type Segment = [text: string, style?: Style];

const number = (n: number) => n.toLocaleString('en-US');

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A duration the way a person says it: 40ms, 4.2s, 12s, 3m 07s, 1h 02m. */
export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad2(Math.floor(s % 60))}s`;
  return `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
}

/** A running clock: 0:07, 12:31, 1:02:09. */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
};

/** `commands` for many, `command` for one. Record types are plural nouns. */
const noun = (plural: string, n: number) => {
  if (n === 1) return plural.endsWith('ies') ? `${plural.slice(0, -3)}y` : plural.replace(/s$/, '');
  return plural;
};

/** A record's one-line label: its name, else the first text it carries. */
function label(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const node = data as { [key: string]: unknown };
  const text =
    nodeLabel(node) ?? Object.values(node).find((v): v is string => typeof v === 'string') ?? '';
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** Segments as one line of at most `width` visible characters, styled after cutting. */
function line(segments: Segment[], width: number): string {
  let left = width;
  let out = '';
  for (const [text, style] of segments) {
    if (left <= 0) break;
    const cut = text.length > left ? `${text.slice(0, Math.max(0, left - 1))}…` : text;
    left -= cut.length;
    out += style ? style(cut) : cut;
  }
  return out;
}

export interface ProgressOptions {
  /** `shell · history`: what the run reads. */
  title: string;
  /** Draw the live view on stderr. Off when stderr isn't a terminal or the data is. */
  live: boolean;
  /** A --limit the run didn't choose, for the hint when it was reached. */
  limit?: number;
  /** Where the records went, when that's a file. */
  output?: string;
  color: string;
}

/**
 * Progress for one extraction: a live view on stderr while it runs (spinner,
 * bar, count, rate, clock, and the record in hand), and a one-line summary
 * when it's done. Anything else written to stderr meanwhile prints above
 * the view, which redraws beneath it.
 */
export class ExtractionProgress {
  processed = 0;
  failed = 0;
  private filtered = 0;
  private counts = new Map<string, number>();
  private current = '';
  private total = 0;
  private readonly startedAt = Date.now();
  private frame = 0;
  private drawn = 0;
  private timer?: NodeJS.Timeout;
  private readonly write = process.stderr.write.bind(process.stderr);
  private readonly c = chalk.stderr;
  private readonly accent: Style;

  constructor(private readonly options: ProgressOptions) {
    this.accent = this.c.hex(options.color);
  }

  start(total: number): void {
    this.total = total;
    if (!this.options.live) return;
    this.write('\u001B[?25l');
    process.once('exit', this.restoreCursor);
    process.stderr.write = ((chunk: any, ...rest: any[]) => {
      this.erase();
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      const written = this.write(text.endsWith('\n') ? text : `${text}\n`, ...rest);
      this.draw();
      return written;
    }) as typeof process.stderr.write;
    this.timer = setInterval(() => {
      this.frame++;
      this.erase();
      this.draw();
    }, TICK);
    this.timer.unref();
    this.draw();
  }

  record(log: RunLog): void {
    if (!log.record) return;
    this.processed++;
    const type = log.record.extraction.recordType ?? 'records';
    this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
    this.failed +=
      log.results.filter(result => !result.success).length +
      (log.validationErrors?.length ?? 0) +
      (log.error ? 1 : 0);
    if (log.filtered) this.filtered++;
    const loaded = log.results.at(-1)?.record?.data;
    this.current = label(loaded ?? log.record.data) || this.current;
  }

  /** Take the live view off the screen, leaving stderr as it was. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.erase();
    process.stderr.write = this.write as typeof process.stderr.write;
    this.restoreCursor();
    process.removeListener('exit', this.restoreCursor);
  }

  /**
   * The finished run, in a line or two: what came out, how long it took,
   * where it went. `hints` are the caller's next moves, printed beneath.
   */
  summary(hints: string[] = []): string {
    const { c } = this;
    const failed = this.failed > 0;
    const counts =
      this.processed === 0
        ? c.dim('no records')
        : [...this.counts]
            .map(([type, n]) => `${c.bold(number(n))} ${noun(type, n)}`)
            .join(c.dim(' · '));
    let head = `${failed ? c.red('✗') : c.green('✓')} ${c.bold(this.options.title)}  ${counts}`;
    if (this.filtered > 0) head += c.dim(` · ${number(this.filtered)} skipped`);
    if (failed) head += c.red(` · ${number(this.failed)} failed`);
    head += c.dim(`  in ${duration(Date.now() - this.startedAt)}`);
    if (this.options.output) head += `${c.dim('  →')} ${this.options.output}`;
    const { limit } = this.options;
    if (limit && limit > 0 && this.processed >= limit) {
      hints = [
        `stopped at --limit ${number(limit)} · pass --limit 0 to extract everything`,
        ...hints,
      ];
    }
    return [head, ...hints.map(hint => c.dim(`  ${hint}`))].join('\n');
  }

  private restoreCursor = () => {
    this.write('\u001B[?25h');
  };

  private bar(): Segment[] {
    if (this.total > 0) {
      const filled = Math.round(Math.min(1, this.processed / this.total) * BAR);
      return [
        ['━'.repeat(filled), this.accent],
        ['━'.repeat(BAR - filled), this.c.dim],
      ];
    }
    // No total to measure against: a highlight sweeps back and forth.
    const span = BAR - SWEEP;
    const step = this.frame % (2 * span);
    const at = step <= span ? step : 2 * span - step;
    return [
      ['━'.repeat(at), this.c.dim],
      ['━'.repeat(SWEEP), this.accent],
      ['━'.repeat(BAR - SWEEP - at), this.c.dim],
    ];
  }

  private draw(): void {
    const width = (process.stderr.columns || 80) - 1;
    const elapsed = Date.now() - this.startedAt;
    const types = [...this.counts.keys()];
    const unit =
      types.length === 1 ? noun(types[0], this.processed) : noun('records', this.processed);
    const count: Segment[] =
      this.total > 0
        ? [[number(this.processed)], ['/', this.c.dim], [`${number(this.total)} ${unit}`]]
        : [[`${number(this.processed)} ${unit}`]];
    const rate =
      elapsed >= 1000 ? `${number(Math.round(this.processed / (elapsed / 1000)))}/s` : '';
    const lines = [
      line(
        [
          [FRAMES[this.frame % FRAMES.length], this.accent],
          [' '],
          [this.options.title, this.c.bold],
          ['  '],
          ...this.bar(),
          ['  '],
          ...count,
          [rate ? `  ${rate}` : '', this.c.dim],
          [`  ${clock(elapsed)}`, this.c.dim],
        ],
        width
      ),
    ];
    if (this.current)
      lines.push(
        line(
          [
            ['  ↳ ', this.c.dim],
            [this.current, this.c.dim],
          ],
          width
        )
      );
    this.write(lines.join('\n'));
    this.drawn = lines.length;
  }

  private erase(): void {
    if (this.drawn === 0) return;
    this.write(`\r\u001B[2K${'\u001B[1A\u001B[2K'.repeat(this.drawn - 1)}`);
    this.drawn = 0;
  }
}
