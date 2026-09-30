export { Logger } from './Logger.js';
export { Aggregator, groupOf, type AggregatorOptions, type ValueCounts } from './aggregate.js';
export { captureConsole } from './console.js';
export { defaultSink, setDefaultSink } from './defaultSink.js';
export { allows, thresholdFor } from './levels.js';
export {
  JsonSink,
  REDACTED,
  TextSink,
  formatFields,
  formatPlain,
  timeOfDay,
  toJson,
  type JsonSinkOptions,
  type TextSinkOptions,
} from './sinks.js';
export type {
  EventKind,
  LoggerContext,
  LoggerOptions,
  LogLevel,
  OutputEvent,
  RunContext,
  Sink,
} from './types.js';

import { Logger } from './Logger.js';
import { LoggerOptions } from './types.js';

/**
 * Factory function to create a logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
