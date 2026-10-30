import type { ProgressFields } from '@chronicle.app/logging';
import { line, type Segment } from './blocks.js';
import { clock, count, plural } from './format.js';
import { glyphs } from './glyphs.js';
import type { Tokens } from './tokens.js';

const BAR = 24;
const TICK = 80;

export type { ProgressFields } from '@chronicle.app/logging';

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
        ? [[processed === 0 ? 'starting' : `${count(processed)} ${unit} extracted`]]
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

// A terminal that supports them shows what's written between these at once;
// others ignore them.
const SYNC_START = '\u001B[?2026h';
const SYNC_END = '\u001B[?2026l';
// Clear to the end of the line, and from the cursor to the end of the screen.
const CLEAR_LINE = '\u001B[K';
const CLEAR_BELOW = '\u001B[J';

/**
 * Lines on stderr, redrawn in place as a spinner ticks. Anything else written
 * to stderr meanwhile prints above them, and they redraw beneath. `render`
 * draws them for a width and a spinner frame, each line within the width.
 * Each redraw is one write over the lines in place, so the terminal never
 * shows them cleared between frames.
 */
export class LiveRegion {
  private frame = 0;
  private drawn = 0;
  private timer?: NodeJS.Timeout;
  private readonly write = process.stderr.write.bind(process.stderr);

  constructor(private readonly render: (width: number, frame: number) => string[]) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.timer) return;
    this.write('\u001B[?25l');
    process.once('exit', this.restoreCursor);
    process.stderr.write = ((chunk: any, ...rest: any[]) => {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      const above = text.endsWith('\n') ? text : `${text}\n`;
      // The text where the lines were, and the lines beneath it.
      const home = this.home();
      const lines = this.frameText();
      return this.write(`${SYNC_START}${home}${CLEAR_BELOW}${above}${lines}${SYNC_END}`, ...rest);
    }) as typeof process.stderr.write;
    this.timer = setInterval(() => {
      this.frame++;
      this.redraw();
    }, TICK);
    this.timer.unref();
    this.write(this.frameText());
  }

  /** Draw what changed now, not on the next tick. */
  redraw(): void {
    if (!this.timer) return;
    const home = this.home();
    const lines = this.frameText();
    this.write(`${SYNC_START}${home}${lines}${CLEAR_BELOW}${SYNC_END}`);
  }

  /** Take the lines off the screen, leaving stderr as it was. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.write(`${this.home()}${CLEAR_BELOW}`);
    this.drawn = 0;
    process.stderr.write = this.write as typeof process.stderr.write;
    this.restoreCursor();
    process.removeListener('exit', this.restoreCursor);
  }

  private restoreCursor = () => {
    this.write('\u001B[?25h');
  };

  /** From the end of the lines drawn back to the start of the first. */
  private home(): string {
    if (this.drawn === 0) return '';
    return `\r${this.drawn > 1 ? `\u001B[${this.drawn - 1}A` : ''}`;
  }

  /** The lines for now, each clearing what a longer line before it left. */
  private frameText(): string {
    const width = (process.stderr.columns || 80) - 1;
    const lines = this.render(width, this.frame);
    this.drawn = lines.length;
    return lines.map(line => `${line}${CLEAR_LINE}`).join('\n');
  }
}

/** Draws {@link progress} on stderr, redrawn in place. */
export class LiveView {
  private fields?: ProgressFields;
  private startedAt = 0;
  private readonly region = new LiveRegion(this.lines.bind(this));

  constructor(private readonly t: Tokens) {}

  get running(): boolean {
    return this.region.running;
  }

  update(fields: ProgressFields): void {
    const moved = this.fields?.phase !== fields.phase;
    this.fields = fields;
    this.startedAt = Date.now() - fields.elapsedMs;
    if (!this.region.running) this.region.start();
    // A new phase shows now, not on the next tick: writing may take less.
    else if (moved) this.region.redraw();
  }

  /** Take the view off the screen, leaving stderr as it was. */
  stop(): void {
    this.region.stop();
  }

  private lines(width: number, frame: number): string[] {
    if (!this.fields) return [];
    const fields = { ...this.fields, elapsedMs: Date.now() - this.startedAt };
    return progress(fields, this.t, width, frame);
  }
}
