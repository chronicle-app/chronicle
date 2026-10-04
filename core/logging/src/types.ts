export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** What an event is, apart from how loud it is. */
export type EventKind =
  'progress' | 'notice' | 'hint' | 'summary' | 'error' | 'diagnostic' | 'guide';

/** The run an event belongs to; a daemon groups events by it, like a trace id. */
export interface RunContext {
  id: string;
  source: string;
  strategy: string;
}

/**
 * One thing worth telling a person or a supervisor. Every line on stderr is
 * the rendering of one of these; a sink decides how it looks.
 */
export interface OutputEvent {
  time: Date;
  level: LogLevel;
  kind: EventKind;
  /** Who spoke: `runner`, `shell.history`, `cli`. */
  scope: string;
  run?: RunContext;
  /** Plain text, no styling, that reads on its own. */
  message: string;
  /** The source of truth: a JSON consumer reads `records: 1240`, not text. */
  fields?: Record<string, unknown>;
  error?: { code?: string; cause?: string; stack?: string; exitCode?: number };
  /** A next move for a person. */
  hint?: { action: string; when?: string };
  /**
   * A `guide` event's body: a section of a walkthrough a person follows,
   * titled by `message`. `text` is a few plain sentences; `steps` are what to
   * do, in order.
   */
  guide?: { text?: string[]; steps?: string[] };
  /** Names of `fields` that carry personal data. */
  sensitive?: string[];
  /** Events sharing a key aggregate: the first few print, the rest are counted. */
  key?: string;
}

/** Where events go. Level filtering, aggregation, and redaction happen here. */
export interface Sink {
  emit(event: OutputEvent): void;
  /** Write anything held back (aggregated counts) and take down live views. */
  flush?(): void;
}

export interface LoggerOptions {
  /** `[ServiceName]` or a bare name; becomes the scope. */
  prefix?: string;
  scope?: string;
  level?: LogLevel;
  quiet?: boolean;
  verbose?: boolean;
  /** The host's sink. Without one, the logger writes plain lines to stderr. */
  sink?: Sink;
  run?: RunContext;
  /** Mark every field personal, as for plugin loggers. */
  sensitive?: boolean;
}

export interface LoggerContext {
  [key: string]: any;
}

/** What a `progress` event carries in its fields: a run as it goes. */
export type ProgressFields = {
  /** `shell · history`: what the run reads. */
  title: string;
  /**
   * `reading` while the source is read in ahead of the run (`processed`
   * counts records read), `loading` once records go through to the output,
   * `writing` while the output flushes at the end.
   */
  phase?: 'reading' | 'loading' | 'writing';
  processed: number;
  /** Records expected, when the source knows; 0 when it doesn't. */
  total: number;
  /** Records by type so far. */
  counts: Record<string, number>;
  /** The record in hand, as a one-line label. Personal. */
  current?: string;
  /** Where a `writing` run's output goes. */
  target?: string;
  elapsedMs: number;
};

/** What a `summary` event carries in its fields: a finished run's totals. */
export type SummaryFields = {
  /** `shell · history`: what the run read. */
  title: string;
  /** Records read, by type, in the order first seen. */
  counts: Record<string, number>;
  records: number;
  /** What reached the output, when that differs from records read less skipped: a fan-out, or failures. */
  written?: number;
  skipped?: number;
  failed?: number;
  durationMs: number;
  /** Where the records went, when that's a file. */
  output?: string;
};
