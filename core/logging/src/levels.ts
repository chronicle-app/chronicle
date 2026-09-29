import type { LogLevel } from './types.js';

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Whether a sink set to `threshold` shows an event at `level`. */
export const allows = (threshold: LogLevel, level: LogLevel) => ORDER[level] >= ORDER[threshold];

/** The threshold the common flags ask for: `--quiet` shows errors, `--verbose` everything. */
export function thresholdFor({
  quiet,
  verbose,
  level,
}: {
  quiet?: boolean;
  verbose?: boolean;
  level?: LogLevel;
}): LogLevel {
  if (quiet) return 'error';
  if (verbose) return 'debug';
  return level ?? 'info';
}
