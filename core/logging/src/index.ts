export { Logger } from './Logger.js';
export { defaultTheme } from './DefaultTheme.js';
export type { LoggerTheme, LoggerOptions, LogLevel, LoggerContext } from './types.js';

import { Logger } from './Logger.js';
import { LoggerOptions } from './types.js';

/**
 * Factory function to create a logger instance
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
