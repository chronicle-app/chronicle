import {
  JsonSink,
  TextSink,
  allows,
  formatFields,
  timeOfDay,
  type LogLevel,
  type OutputEvent,
  type Sink,
} from '@chronicle.app/logging';
import { hint, line, summary, type Segment, type SummaryFields } from './blocks.js';
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

/**
 * An event as lines for a person, each at most `width` wide: the pretty and
 * plain sinks' shared look. Progress is left to the live view.
 */
export function render(event: OutputEvent, t: Tokens, width: number): string | undefined {
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
  // An aggregate's count is already in its message.
  const { suppressed: _, ...shown } = event.fields ?? {};
  const fields = formatFields(event.key ? shown : event.fields);
  const lines = [
    line(
      [
        [glyph, glyphStyle],
        [' '],
        [HOST.has(event.scope) || !event.scope ? '' : `${event.scope}  `, t.muted],
        [first, textStyle],
        [fields ? `  ${fields}` : '', t.muted],
        [event.hint ? `  ${glyphs.bullet} ${event.hint.action}` : '', t.muted],
      ] as Segment[],
      width
    ),
    ...rest.map(text => line([[`  ${text}`, textStyle]], width)),
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
 * For a person at a terminal: color, no timestamps, and a live progress
 * line redrawn in place while a run goes.
 */
export class PrettySink extends TextSink {
  private readonly view?: LiveView;

  constructor(options: SinkOptions & { live?: boolean }) {
    const t = tokens({ stream: 'stderr', theme: options.theme, color: options.color });
    super({
      level: options.level,
      write: options.write,
      format: event => render(event, t, options.width ?? terminalWidth()),
    });
    if (options.live) this.view = new LiveView(t);
  }

  override emit(event: OutputEvent): void {
    if (event.kind === 'progress') {
      if (this.view && allows(this.level, 'info'))
        this.view.update(event.fields as unknown as ProgressFields);
      return;
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

export interface OutputOptions extends SinkOptions {
  format?: LogFormat;
  /** Draw live progress (pretty only). */
  live?: boolean;
  /** Keep personal fields in JSON (`--log-personal`). */
  personal?: boolean;
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
