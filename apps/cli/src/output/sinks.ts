import {
  JsonSink,
  TextSink,
  allows,
  formatFields,
  thresholdFor,
  timeOfDay,
  type LogLevel,
  type OutputEvent,
  type Sink,
} from '@chronicle.app/logging';
import { hint, line, summary, type Segment, type SummaryFields } from './blocks.js';
import { count } from './format.js';
import { glyphs } from './glyphs.js';
import { LiveView, type ProgressFields } from './live.js';
import { plainTokens, tokens, type Tokens } from './tokens.js';

export const LOG_FORMATS = ['pretty', 'plain', 'json'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

/** Pretty for a person at a terminal, plain lines for a file or pipe. */
export const defaultLogFormat = (): LogFormat => (process.stderr.isTTY ? 'pretty' : 'plain');

/** Scopes that are the CLI itself, and don't need naming. */
const HOST = new Set(['cli', 'runner']);

const isSummary = (fields: unknown): fields is SummaryFields =>
  typeof fields === 'object' &&
  fields !== null &&
  typeof (fields as SummaryFields).title === 'string' &&
  typeof (fields as SummaryFields).counts === 'object';

/** Space between a line and the time at its right edge. */
const TIME_GAP = 2;

/** A roll-up's fields: how many it held back, and how often each value came up. */
type Rollup = {
  suppressed: number;
  values?: Record<string, Record<string, number>>;
  personal?: Record<string, Record<string, number>>;
};

const isRollup = (fields: unknown): fields is Rollup =>
  typeof (fields as Rollup | undefined)?.suppressed === 'number';

/** `recordType: blocks 300 · connections 112 · +3 more`, per field, most common first. */
function tally({ values, personal }: Rollup): string {
  return Object.entries({ ...values, ...personal })
    .map(([field, counts]) => {
      const ranked = Object.entries(counts).sort(([, a], [, b]) => b - a);
      const top = ranked.slice(0, 3).map(([value, n]) => `${value} ${count(n)}`);
      if (ranked.length > 3) top.push(`+${ranked.length - 3} more`);
      return `${field}: ${top.join(` ${glyphs.bullet} `)}`;
    })
    .join('  ');
}

/** An event's fields as `key=value`, less a URL, which gets a line of its own. */
function fieldText(event: OutputEvent): string {
  const { url, ...others } = event.fields ?? {};
  return formatFields(typeof url === 'string' ? others : event.fields);
}

/**
 * An event as lines for a person, each at most `width` wide: the pretty and
 * plain sinks' shared look. Progress is left to the live view. With `time`,
 * notices, errors, and diagnostics end with the time of day, right-aligned
 * and muted, when the width is known and the line has room for it.
 */
export function render(
  event: OutputEvent,
  t: Tokens,
  width: number,
  { time = false }: { time?: boolean } = {}
): string | undefined {
  switch (event.kind) {
    case 'progress':
      return undefined;
    case 'summary':
      return isSummary(event.fields)
        ? summary(event.fields, t, width)
        : line(
            [
              event.level === 'error' ? [glyphs.failure, t.danger] : [glyphs.success, t.success],
              [` ${event.message}`],
            ],
            width
          );
    case 'hint':
      return hint(event.message, event.hint?.action, t, width);
  }
  const [glyph, glyphStyle, textStyle] =
    event.level === 'error'
      ? [glyphs.failure, t.danger, undefined]
      : event.level === 'warn'
        ? [glyphs.warning, t.warning, undefined]
        : event.level === 'debug'
          ? [glyphs.bullet, t.muted, t.muted]
          : [glyphs.bullet, t.muted, undefined];
  const [first, ...rest] = event.message.split('\n');
  const fields = event.key && isRollup(event.fields) ? tally(event.fields) : fieldText(event);
  const segments: Segment[] = [
    [glyph, glyphStyle],
    [' '],
    [HOST.has(event.scope) || !event.scope ? '' : `${event.scope}  `, t.muted],
    [event.level === 'error' ? `Error: ${first}` : first, textStyle],
    [fields ? `  ${fields}` : '', t.muted],
  ];
  const length = segments.reduce((sum, [text]) => sum + text.length, 0);
  const stamp = timeOfDay(event.time);
  // The message comes first: the time is dropped, never the text cut for it.
  const stamped = time && Number.isFinite(width) && length + TIME_GAP + stamp.length <= width;
  const lines = [
    stamped
      ? line(segments, width) + ' '.repeat(width - length - stamp.length) + t.muted(stamp)
      : line(segments, width),
    ...rest.map(text => line([[`  ${text}`, textStyle]], width)),
    // Never cut: a URL is for opening, and the terminal wraps it whole.
    ...(typeof event.fields?.url === 'string' ? [`  ${event.fields.url}`] : []),
    // What to do about it, on its own lines, like any hint.
    ...(event.hint ? [hint('', event.hint.action, t, width)] : []),
  ];
  return lines.join('\n');
}

export interface SinkOptions {
  /** The quietest level shown. */
  level: LogLevel;
  theme?: string;
  /** Columns to fit; default the terminal's, or unbounded when stderr isn't one. */
  width?: number;
  write?: (text: string) => void;
  /** Force color on or off (the gallery), instead of detecting it. */
  color?: boolean;
}

const terminalWidth = () =>
  process.stderr.isTTY ? (process.stderr.columns || 80) - 1 : Number.POSITIVE_INFINITY;

/**
 * For a person at a terminal: color, the time of day at the right edge of
 * notices and errors, and a live progress line redrawn in place while a run
 * goes.
 */
export class PrettySink extends TextSink {
  private view?: LiveView;
  private readonly live: Live;
  private readonly air: boolean;

  constructor(options: SinkOptions & { live?: Live; air?: boolean }) {
    const t = tokens({ stream: 'stderr', theme: options.theme, color: options.color });
    super({
      level: options.level,
      write: options.write,
      format: event => render(event, t, options.width ?? terminalWidth(), { time: true }),
    });
    this.live = options.live ?? false;
    if (this.live) this.view = new LiveView(t);
    this.air = options.air ?? false;
  }

  override emit(event: OutputEvent): void {
    if (event.kind === 'progress') {
      const fields = event.fields as unknown as ProgressFields;
      if (
        (this.live === 'until-loading' && fields.phase === 'loading') ||
        (this.live === 'until-writing' && fields.phase === 'writing')
      ) {
        // Records are about to share the terminal: the view steps aside for good.
        this.view?.stop();
        this.view = undefined;
      }
      if (this.view && allows(this.level, 'info')) this.view.update(fields);
      return;
    }
    // The run is over: its live view comes down before the summary prints.
    if (event.kind === 'summary') this.view?.stop();
    // Records on this same screen get a line of air before the summary.
    const records = (event.fields as { records?: number } | undefined)?.records ?? 0;
    if (this.air && event.kind === 'summary' && records > 0 && allows(this.level, event.level)) {
      this.drain();
      this.write('\n');
    }
    super.emit(event);
  }

  override flush(): void {
    this.view?.stop();
    super.flush();
  }
}

/** For a file or pipe: no color, no frames, each line stamped with the time. */
export class PlainSink extends TextSink {
  constructor(options: SinkOptions) {
    const width = options.width ?? terminalWidth();
    super({
      level: options.level,
      write: options.write,
      format(event) {
        const stamp = `${timeOfDay(event.time)} `;
        const text = render(event, plainTokens, width - stamp.length);
        return text === undefined
          ? undefined
          : text
              .split('\n')
              .map(part => stamp + part)
              .join('\n');
      },
    });
  }
}

/**
 * Whether the pretty sink draws live progress: throughout the run, or only
 * until records start loading or the output starts writing, when they print
 * to the same terminal.
 */
export type Live = boolean | 'until-loading' | 'until-writing';

export interface OutputOptions extends SinkOptions {
  format?: LogFormat;
  /** Draw live progress (pretty only). */
  live?: Live;
  /** Keep personal fields in JSON (`--log-personal`). */
  personal?: boolean;
  /** A blank line before a summary, when records shared the terminal (pretty only). */
  air?: boolean;
}

/** The sink `--log-format` asks for. */
export function createSink(options: OutputOptions): Sink {
  switch (options.format ?? defaultLogFormat()) {
    case 'json':
      return new JsonSink({
        level: options.level,
        write: options.write,
        personal: options.personal,
      });
    case 'plain':
      return new PlainSink(options);
    default:
      return new PrettySink(options);
  }
}

/** The flags that shape output, as a command has them. */
export interface OutputFlags {
  quiet?: boolean;
  verbose?: boolean;
  theme?: string;
  'log-format'?: LogFormat;
  'log-personal'?: boolean;
}

/** The sink a command's flags ask for. */
export const sinkFor = (flags: OutputFlags, extra: { live?: Live } = {}): Sink =>
  createSink({
    format: flags['log-format'],
    level: thresholdFor(flags),
    theme: flags.theme,
    personal: flags['log-personal'],
    ...extra,
  });

/**
 * The output flags in raw argv, for output before oclif has parsed them
 * (plugin discovery runs first).
 */
export function outputFlagsIn(argv: string[]): OutputFlags {
  const value = (name: string) => {
    const i = argv.findIndex(arg => arg === name || arg.startsWith(`${name}=`));
    if (i < 0) return;
    return argv[i].includes('=') ? argv[i].slice(name.length + 1) : argv[i + 1];
  };
  const format = value('--log-format');
  return {
    quiet: argv.includes('--quiet') || argv.includes('-q'),
    verbose: argv.includes('--verbose') || argv.includes('-v'),
    theme: value('--theme'),
    ...(LOG_FORMATS.includes(format as LogFormat) && { 'log-format': format as LogFormat }),
    'log-personal': argv.includes('--log-personal'),
  };
}
