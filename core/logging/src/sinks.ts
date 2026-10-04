import { Aggregator, type AggregatorOptions } from './aggregate.js';
import { allows } from './levels.js';
import type { LogLevel, OutputEvent, Sink } from './types.js';

/** Resolved at each write, so a live view that wraps stderr still sees it. */
const stderr = (text: string) => {
  process.stderr.write(text);
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `HH:MM:SS` in local time. */
export const timeOfDay = (date: Date) =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

/** `key=value` pairs, values compact: strings bare, the rest as JSON. */
export function formatFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return '';
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
}

/** The default line for a host that brings no formatter: time, level, scope, message, fields. */
export function formatPlain(event: OutputEvent): string {
  const level = event.level === 'info' ? '' : `${event.level} `;
  const fields = formatFields(event.fields);
  const hint = event.hint ? ` · ${event.hint.action}` : '';
  const guide = event.guide
    ? [
        ...(event.guide.text ?? []),
        ...(event.guide.steps ?? []).map((step, i) => `${i + 1}. ${step}`),
      ].map(part => `\n  ${part}`)
    : [];
  return `${timeOfDay(event.time)} ${level}${event.scope}: ${event.message}${hint}${fields ? ` ${fields}` : ''}${guide.join('')}`;
}

/** How often a sink checks for roll-ups that came due while nothing else arrived. */
const TICK_MS = 1000;

/**
 * Prints roll-ups on time even when a group goes quiet: while events are held
 * back, a timer checks once a second. It never keeps the process alive.
 */
class RollupTimer {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly aggregator: Aggregator,
    private readonly print: (event: OutputEvent) => void
  ) {}

  arm(): void {
    if (this.timer || !this.aggregator.pending) return;
    this.timer = setInterval(() => {
      for (const event of this.aggregator.due(Date.now())) this.print(event);
      if (!this.aggregator.pending) this.stop();
    }, TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

export interface TextSinkOptions {
  /** The quietest level shown. Default `info`. */
  level?: LogLevel;
  write?: (text: string) => void;
  /** An event as text, or undefined to say nothing. Default {@link formatPlain}. */
  format?: (event: OutputEvent) => string | undefined;
  /** How repeated events group: examples shown, then roll-ups per window. */
  aggregate?: AggregatorOptions;
}

/**
 * Events as lines of text for a person. Progress is left to sinks that can
 * draw it; keyed events aggregate, and the counts print before the summary.
 */
export class TextSink implements Sink {
  readonly level: LogLevel;
  protected readonly write: (text: string) => void;
  private readonly format: (event: OutputEvent) => string | undefined;
  private readonly aggregator: Aggregator;
  private readonly rollups: RollupTimer;
  /** Hints from a run, printed under its summary rather than mid-run. */
  private held: OutputEvent[] = [];
  private summarized = new Set<string>();

  constructor(options: TextSinkOptions = {}) {
    this.level = options.level ?? 'info';
    this.write = options.write ?? stderr;
    this.format = options.format ?? formatPlain;
    this.aggregator = new Aggregator(options.aggregate);
    this.rollups = new RollupTimer(this.aggregator, event => this.print(event));
  }

  emit(event: OutputEvent): void {
    if (!allows(this.level, event.level) || event.kind === 'progress') return;
    // Hints go under the summary: a run's hints wait for it (or for a flush,
    // if the run fails). Hints outside a run print as they come.
    if (event.kind === 'hint' && event.run && !this.summarized.has(event.run.id)) {
      this.held.push(event);
      return;
    }
    if (event.kind === 'summary') this.drain();
    for (const shown of this.aggregator.admit(event)) this.print(shown);
    if (event.kind === 'summary') {
      if (event.run) this.summarized.add(event.run.id);
      this.release(event.run?.id);
    }
    this.rollups.arm();
  }

  flush(): void {
    this.drain();
    this.release();
  }

  /** Report what the groups held back. */
  protected drain(): void {
    this.rollups.stop();
    for (const event of this.aggregator.drain()) {
      if (allows(this.level, event.level)) this.print(event);
    }
  }

  /** Print held hints: a run's, or all of them. */
  private release(run?: string): void {
    const now = this.held.filter(event => run === undefined || event.run?.id === run);
    this.held = this.held.filter(event => !now.includes(event));
    for (const event of now) this.print(event);
  }

  protected print(event: OutputEvent): void {
    const text = this.format(event);
    if (text !== undefined) this.write(`${text}\n`);
  }
}

export const REDACTED = '[redacted]';

/** An event as one JSON object, its personal fields redacted. */
export function toJson(event: OutputEvent): Record<string, unknown> {
  let { fields } = event;
  if (fields && event.sensitive?.length) {
    fields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        event.sensitive!.includes(key) ? REDACTED : value,
      ])
    );
  }
  return {
    time: event.time.toISOString(),
    level: event.level,
    kind: event.kind,
    scope: event.scope,
    ...(event.run && { run: event.run }),
    message: event.message,
    ...(fields && { fields }),
    ...(event.error && { error: event.error }),
    ...(event.hint && { hint: event.hint }),
    ...(event.guide && { guide: event.guide }),
    ...(event.sensitive?.length && { sensitive: event.sensitive }),
    ...(event.key && { key: event.key }),
  };
}

export interface JsonSinkOptions {
  level?: LogLevel;
  write?: (text: string) => void;
  /** At most one progress event per run in this many milliseconds. Default 10s. */
  heartbeatMs?: number;
  aggregate?: AggregatorOptions;
}

/**
 * Events as JSON lines for a daemon or supervisor. Progress becomes a
 * heartbeat, hints stay data, and personal fields are redacted.
 */
export class JsonSink implements Sink {
  readonly level: LogLevel;
  private readonly write: (text: string) => void;
  private readonly heartbeatMs: number;
  private readonly aggregator: Aggregator;
  private readonly rollups: RollupTimer;
  private lastBeat = new Map<string, number>();

  constructor(options: JsonSinkOptions = {}) {
    this.level = options.level ?? 'info';
    this.write = options.write ?? stderr;
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
    this.aggregator = new Aggregator(options.aggregate);
    this.rollups = new RollupTimer(this.aggregator, event => this.print(event));
  }

  emit(event: OutputEvent): void {
    if (event.kind === 'progress') {
      // Progress is debug-level chatter, but its heartbeat is how a supervisor
      // knows a run is alive: shown at the default threshold, not under --quiet.
      if (!allows(this.level, 'info')) return;
      const run = event.run?.id ?? '';
      const last = this.lastBeat.get(run);
      if (last !== undefined && event.time.getTime() - last < this.heartbeatMs) return;
      this.lastBeat.set(run, event.time.getTime());
      this.print(event);
      return;
    }
    if (!allows(this.level, event.level)) return;
    if (event.kind === 'summary') this.flush();
    for (const shown of this.aggregator.admit(event)) this.print(shown);
    this.rollups.arm();
  }

  flush(): void {
    this.rollups.stop();
    for (const event of this.aggregator.drain()) {
      if (allows(this.level, event.level)) this.print(event);
    }
  }

  private print(event: OutputEvent): void {
    this.write(`${JSON.stringify(toJson(event))}\n`);
  }
}
