import { format } from 'node:util';
import type { Logger } from './Logger.js';
import type { LogLevel } from './types.js';

const METHODS = {
  debug: 'debug',
  trace: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
} satisfies Record<string, LogLevel>;

/**
 * Route `console.*` through `logger` as diagnostics until the returned
 * function restores it: code that writes to the console (a third-party
 * plugin, a dependency) still reaches the host's sink, never stdout.
 */
export function captureConsole(logger: Logger): () => void {
  const original = new Map<string, unknown>();
  for (const [method, level] of Object.entries(METHODS)) {
    original.set(method, (console as any)[method]);
    (console as any)[method] = (...args: unknown[]) => {
      logger.emit({ level, kind: 'diagnostic', message: format(...args) });
    };
  }
  return () => {
    for (const [method, fn] of original) (console as any)[method] = fn;
  };
}
