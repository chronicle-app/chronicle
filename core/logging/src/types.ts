export interface LoggerTheme {
  info: (message: string) => string;
  warn: (message: string) => string;
  error: (message: string) => string;
  debug: (message: string) => string;
}

export interface LoggerOptions {
  prefix?: string;
  level?: LogLevel;
  theme?: LoggerTheme;
  quiet?: boolean;
  verbose?: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerContext {
  [key: string]: any;
}
