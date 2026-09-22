import { LoggerOptions, LoggerTheme, LogLevel, LoggerContext } from './types.js';
import { defaultTheme } from './DefaultTheme.js';
import chalk from 'chalk';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private prefix: string;
  private level: LogLevel;
  private quiet: boolean;
  private verbose: boolean;
  private theme: LoggerTheme;

  constructor(options: LoggerOptions = {}) {
    this.prefix = options.prefix ? `${options.prefix} ` : '';
    this.level = options.level ?? 'info';
    this.quiet = options.quiet ?? false;
    this.verbose = options.verbose ?? false;
    this.theme = options.theme ?? defaultTheme;

    // Only enable colors when writing to a real terminal (not when PM2 captures stderr)
    if (process.stderr.isTTY) {
      chalk.level = 3; // Force full color support for terminals
    } else {
      chalk.level = 0; // Disable colors for file/pipe output
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (level === 'error') return true; // Always show errors
    if (this.quiet) return false;
    if (level === 'debug') return this.verbose; // Debug messages only in verbose mode
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private formatPrefix(serviceName: string): string {
    // Extract service name from prefix like '[ServiceName]' or just use as-is
    const match = serviceName.match(/\[([^\]]+)\]/);
    const name = match ? match[1] : serviceName.replaceAll(/^\s*|\s*$/g, '');

    // Fixed width of 25 characters, left-aligned
    return name.padEnd(25);
  }

  private formatMessage(
    message: string,
    context?: LoggerContext,
    multiline: boolean = false
  ): string {
    const service = this.prefix ? this.formatPrefix(this.prefix) : ''.padEnd(25);

    let formatted = `${service} ${message}`;
    if (context && Object.keys(context).length > 0) {
      if (multiline) {
        // Custom JSON formatting: compact arrays, multiline objects
        const compactJson = this.formatCompactJson(context);
        formatted += `\n${compactJson}`;
      } else {
        formatted += ` ${JSON.stringify(context)}`;
      }
    }
    return formatted;
  }

  private formatCompactJson(obj: LoggerContext, depth = 0): string {
    const indent = '  '.repeat(depth);
    const nextIndent = '  '.repeat(depth + 1);

    if (Array.isArray(obj)) {
      // Keep arrays on single line for compactness
      return JSON.stringify(obj);
    }

    if (obj && typeof obj === 'object') {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '{}';

      const formatted = entries
        .map(
          ([key, value]) =>
            `${nextIndent}"${key}": ${this.formatCompactJson(value as LoggerContext, depth + 1)}`
        )
        .join(',\n');

      return `{\n${formatted}\n${indent}}`;
    }

    return JSON.stringify(obj);
  }

  debug(message: string, context?: LoggerContext): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage(message, context);
      process.stderr.write(`${this.theme.debug(formatted)}\n`);
    }
  }

  debugMultiline(message: string, context?: LoggerContext): void {
    if (this.shouldLog('debug')) {
      const formatted = this.formatMessage(message, context, true);
      process.stderr.write(`${this.theme.debug(formatted)}\n`);
    }
  }

  info(message: string, context?: LoggerContext): void {
    if (this.shouldLog('info')) {
      const formatted = this.formatMessage(message, context);
      process.stderr.write(`${this.theme.info(formatted)}\n`);
    }
  }

  verboseInfo(message: string, context?: LoggerContext): void {
    if (!this.quiet && this.verbose) {
      const formatted = this.formatMessage(message, context);
      process.stderr.write(`${this.theme.info(formatted)}\n`);
    }
  }

  warn(message: string, context?: LoggerContext): void {
    if (this.shouldLog('warn')) {
      const formatted = this.formatMessage(message, context);
      process.stderr.write(`${this.theme.warn(formatted)}\n`);
    }
  }

  error(message: string, context?: LoggerContext): void {
    const formatted = this.formatMessage(message, context);
    process.stderr.write(`${this.theme.error(formatted)}\n`);
  }
}
