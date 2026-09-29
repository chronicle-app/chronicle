import { thresholdFor } from './levels.js';
import { TextSink } from './sinks.js';
import type {
  EventKind,
  LoggerContext,
  LoggerOptions,
  LogLevel,
  OutputEvent,
  RunContext,
  Sink,
} from './types.js';

/** `[ServiceName]` → `ServiceName`. */
const scopeOf = (prefix: string) => prefix.match(/\[([^\]]+)\]/)?.[1] ?? prefix.trim();

/**
 * Emits events to a sink. Each call becomes an {@link OutputEvent} with this
 * logger's scope and run; the second argument becomes the event's `fields`.
 * Without a host sink, events print as plain lines on stderr.
 */
export class Logger {
  private scope: string;
  private sink: Sink;
  private run?: RunContext;
  private readonly sensitive: boolean;

  constructor(options: LoggerOptions = {}) {
    this.scope = options.scope ?? (options.prefix ? scopeOf(options.prefix) : '');
    this.sink = options.sink ?? new TextSink({ level: thresholdFor(options) });
    this.run = options.run;
    this.sensitive = options.sensitive ?? false;
  }

  /** Send events to the host's sink from now on, for its run, under `scope` if given. */
  use(sink: Sink, { run, scope }: { run?: RunContext; scope?: string } = {}): void {
    this.sink = sink;
    if (run) this.run = run;
    if (scope) this.scope = scope;
  }

  /** Emit an event of any kind; `time`, `scope`, and `run` default to this logger's. */
  emit(event: Omit<OutputEvent, 'time' | 'scope'> & Partial<OutputEvent>): void {
    this.sink.emit({
      time: new Date(),
      scope: this.scope,
      ...(this.run && { run: this.run }),
      ...event,
    });
  }

  flush(): void {
    this.sink.flush?.();
  }

  private log(level: LogLevel, kind: EventKind, message: string, context?: LoggerContext) {
    const fields = context && Object.keys(context).length > 0 ? context : undefined;
    this.emit({
      level,
      kind,
      message,
      ...(fields && { fields }),
      ...(fields && this.sensitive && { sensitive: Object.keys(fields) }),
    });
  }

  debug(message: string, context?: LoggerContext): void {
    this.log('debug', 'diagnostic', message, context);
  }

  debugMultiline(message: string, context?: LoggerContext): void {
    this.log('debug', 'diagnostic', message, context);
  }

  info(message: string, context?: LoggerContext): void {
    this.log('info', 'notice', message, context);
  }

  verboseInfo(message: string, context?: LoggerContext): void {
    this.log('debug', 'diagnostic', message, context);
  }

  warn(message: string, context?: LoggerContext): void {
    this.log('warn', 'notice', message, context);
  }

  error(message: string, context?: LoggerContext): void {
    this.log('error', 'error', message, context);
  }
}
