import chalk from 'chalk';
import { LoggerTheme } from './types.js';

// Enhanced theme with colored icons/timestamps only
export const defaultTheme: LoggerTheme = {
  debug: msg => `${chalk.gray('⚪')} ${msg}`,
  info: msg => `${chalk.blue('ℹ')} ${msg}`,
  warn: msg => `${chalk.yellow('⚠')} ${msg}`,
  error: msg => `${chalk.red('✖')} ${msg}`,
};
