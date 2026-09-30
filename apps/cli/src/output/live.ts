import { line, type Segment } from './blocks.js';
import { clock, count, plural } from './format.js';
import { glyphs } from './glyphs.js';
import type { Tokens } from './tokens.js';

const BAR = 24;
const TICK = 80;

/** What a `progress` event carries in its fields. */
export type ProgressFields = {
  /** `shell · history`: what the run reads. */
  title: string;
  processed: number;
  /** Records expected, when the source knows; 0 when it doesn't. */
  total: number;
  /**
   * `reading` while the source is read in ahead of the run (`processed`
   * counts records read), `loading` once records go through to the output,
   * `writing` while the output flushes at the end.
   */
  phase?: 'reading' | 'loading' | 'writing';
  /** Where a `writing` run's output goes. */
  target?: string;
  /** Records by type so far. */
  counts: Record<string, number>;
  /** The record in hand, as a one-line label. Personal. */
  current?: string;
  elapsedMs: number;
};

/** A bar filled in proportion to the total; nothing when there's no total to measure against. */
function bar(fields: ProgressFields, t: Tokens): Segment[] {
  if (fields.total <= 0 || fields.phase === 'writing') return [];
  const filled = Math.round(Math.min(1, fields.processed / fields.total) * BAR);
  return [
    [glyphs.bar.repeat(filled), t.accent],
    [glyphs.bar.repeat(BAR - filled), t.muted],
    ['  '],
  ];
}

/**
 * The live view of a run: spinner, bar, count, rate, and clock, and the
 * record in hand beneath. Without a known total there's no bar: the spinner
 * alone says the run is alive, so nothing looks like progress it isn't.
 */
export function progress(fields: ProgressFields, t: Tokens, width: number, frame = 0): string[] {
  const { processed, total, elapsedMs } = fields;
  const types = Object.keys(fields.counts);
  const unit = types.length === 1 ? plural(types[0], processed) : plural('records', processed);
  const counted: Segment[] =
    fields.phase === 'writing'
      ? [[`writing ${fields.target ?? 'output'}`], [`  ${count(processed)} ${unit}`, t.muted]]
      : fields.phase === 'reading'
        ? [[processed === 0 ? 'starting' : `${count(processed)} ${unit} read`]]
        : total > 0
          ? [[count(processed)], ['/', t.muted], [`${count(total)} ${unit}`]]
          : [[`${count(processed)} ${unit}`]];
  const rate =
    fields.phase !== 'writing' && elapsedMs >= 1000
      ? `${count(Math.round(processed / (elapsedMs / 1000)))}/s`
      : '';
  const lines = [
    line(
      [
        [glyphs.spinner[frame % glyphs.spinner.length], t.accent],
        [' '],
        [fields.title, t.strong],
        ['  '],
        ...bar(fields, t),
        ...counted,
        [rate ? `  ${rate}` : '', t.muted],
        [`  ${clock(elapsedMs)}`, t.muted],
      ],
      width
    ),
  ];
  if (fields.current) {
    lines.push(
      line(
        [
          [`  ${glyphs.child} `, t.muted],
          [fields.current, t.muted],
        ],
        width
      )
    );
  }
  return lines;
}

/**
 * Draws {@link progress} on stderr, redrawn in place. Anything else written to
 * stderr meanwhile prints above it, and it redraws beneath.
 */
export class LiveView {
  private fields?: ProgressFields;
  private startedAt = 0;
  private frame = 0;
  private drawn = 0;
  private timer?: NodeJS.Timeout;
  private readonly write = process.stderr.write.bind(process.stderr);

  constructor(private readonly t: Tokens) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  update(fields: ProgressFields): void {
    const moved = this.fields?.phase !== fields.phase;
    this.fields = fields;
    this.startedAt = Date.now() - fields.elapsedMs;
    if (!this.timer) this.start();
    else if (moved) {
      // A new phase shows now, not on the next tick: writing may take less.
      this.erase();
      this.draw();
    }
  }

  private start(): void {
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

  /** Take the view off the screen, leaving stderr as it was. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.erase();
    process.stderr.write = this.write as typeof process.stderr.write;
    this.restoreCursor();
    process.removeListener('exit', this.restoreCursor);
  }

  private restoreCursor = () => {
    this.write('\u001B[?25h');
  };

  private draw(): void {
    if (!this.fields) return;
    const width = (process.stderr.columns || 80) - 1;
    const fields = { ...this.fields, elapsedMs: Date.now() - this.startedAt };
    const lines = progress(fields, this.t, width, this.frame);
    this.write(lines.join('\n'));
    this.drawn = lines.length;
  }

  private erase(): void {
    if (this.drawn === 0) return;
    this.write(`\r\u001B[2K${'\u001B[1A\u001B[2K'.repeat(this.drawn - 1)}`);
    this.drawn = 0;
  }
}
