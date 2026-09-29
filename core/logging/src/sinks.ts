import { Aggregator } from './aggregate.js';
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
  return `${timeOfDay(event.time)} ${level}${event.scope}: ${event.message}${hint}${fields ? ` ${fields}` : ''}`;
}

export interface TextSinkOptions {
  /** The quietest level shown. Default `info`. */
  level?: LogLevel;
  write?: (text: string) => void;
  /** An event as text, or undefined to say nothing. Default {@link formatPlain}. */
  format?: (event: OutputEvent) => string | undefined;
  /** Keyed events shown before the rest are counted. Default 3. */
  examples?: number;
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

  constructor(options: TextSinkOptions = {}) {
    this.level = options.level ?? 'info';
    this.write = options.write ?? stderr;
    this.format = options.format ?? formatPlain;
    this.aggregator = new Aggregator(options.examples);
  }

  emit(event: OutputEvent): void {
    if (!allows(this.level, event.level) || event.kind === 'progress') return;
    if (event.kind === 'summary') this.flush();
    if (this.aggregator.admit(event)) this.print(event);
  }

  flush(): void {
    for (const event of this.aggregator.drain()) {
      if (allows(this.level, event.level)) this.print(event);
    }
  }

  protected print(event: OutputEvent): void {
    const text = this.format(event);
    if (text !== undefined) this.write(`${text}\n`);
  }
}

export const REDACTED = '[redacted]';

/** An event as one JSON object, its personal fields redacted unless `personal`. */
export function toJson(event: OutputEvent, personal = false): Record<string, unknown> {
  let { fields } = event;
  if (fields && event.sensitive?.length && !personal) {
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
    ...(event.sensitive?.length && { sensitive: event.sensitive }),
    ...(event.key && { key: event.key }),
  };
}

export interface JsonSinkOptions {
  level?: LogLevel;
  write?: (text: string) => void;
  /** Keep personal fields instead of redacting them (`--log-personal`). */
  personal?: boolean;
  /** At most one progress event per run in this many milliseconds. Default 10s. */
  heartbeatMs?: number;
  examples?: number;
}

/**
 * Events as JSON lines for a daemon or supervisor. Progress becomes a
 * heartbeat, hints stay data, and personal fields are redacted.
 */
export class JsonSink implements Sink {
  readonly level: LogLevel;
  private readonly write: (text: string) => void;
  private readonly personal: boolean;
  private readonly heartbeatMs: number;
  private readonly aggregator: Aggregator;
  private lastBeat = new Map<string, number>();

  constructor(options: JsonSinkOptions = {}) {
    this.level = options.level ?? 'info';
    this.write = options.write ?? stderr;
    this.personal = options.personal ?? false;
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
    this.aggregator = new Aggregator(options.examples);
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
    if (this.aggregator.admit(event)) this.print(event);
  }

  flush(): void {
    for (const event of this.aggregator.drain()) {
      if (allows(this.level, event.level)) this.print(event);
    }
  }

  private print(event: OutputEvent): void {
    this.write(`${JSON.stringify(toJson(event, this.personal))}\n`);
  }
}
