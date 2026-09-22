import { z } from 'zod';
import chalk from 'chalk';
import { writeFileSync, appendFileSync } from 'node:fs';
import { LoadResult, Record } from './types.js';
import { Loader } from './loader.js';

export interface JsonColorTheme {
  StringLiteral: typeof chalk.green;
  NumberLiteral: typeof chalk.cyan;
  BooleanLiteral: typeof chalk.yellow;
  NullLiteral: typeof chalk.gray;
  StringKey: typeof chalk.blue;
  Whitespace: typeof chalk.white;
  Brace: typeof chalk.dim;
  Bracket: typeof chalk.dim;
  Colon: typeof chalk.dim;
  Comma: typeof chalk.dim;
}

// Simple JSON colorizer using Chalk (same as json-colorizer but using Chalk directly)
export function colorizeJson(obj: any, theme?: JsonColorTheme, singleLine?: boolean): string {
  const colors = theme || {
    StringLiteral: chalk.green,
    NumberLiteral: chalk.cyan,
    BooleanLiteral: chalk.yellow,
    NullLiteral: chalk.gray,
    StringKey: chalk.blue,
    Whitespace: chalk.white,
    Brace: chalk.dim,
    Bracket: chalk.dim,
    Colon: chalk.dim,
    Comma: chalk.dim,
  };

  function colorizeValue(value: any, indent = 0): string {
    const spaces = '  '.repeat(indent);

    if (value === null) {
      return colors.NullLiteral('null');
    }

    if (typeof value === 'string') {
      return colors.StringLiteral(JSON.stringify(value));
    }

    if (typeof value === 'number') {
      return colors.NumberLiteral(value.toString());
    }

    if (typeof value === 'boolean') {
      return colors.BooleanLiteral(value.toString());
    }

    // Dates have no enumerable keys, so the object branch below would render
    // them as `{}`. Match JSON.stringify: ISO string, or null if invalid.
    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? colors.NullLiteral('null')
        : colors.StringLiteral(`"${value.toISOString()}"`);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return colors.Bracket('[]');
      }

      if (singleLine) {
        const items = value.map(item => colorizeValue(item, indent + 1)).join(colors.Comma(', '));
        return colors.Bracket('[') + items + colors.Bracket(']');
      }
      const items = value
        .map(item => `${spaces}  ${colorizeValue(item, indent + 1)}`)
        .join(colors.Comma(',\n'));
      return colors.Bracket('[') + '\n' + items + '\n' + spaces + colors.Bracket(']');
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return colors.Brace('{}');
      }

      if (singleLine) {
        const items = keys
          .map(
            key =>
              `${colors.StringKey(JSON.stringify(key))}${colors.Colon(': ')}${colorizeValue(value[key], indent + 1)}`
          )
          .join(colors.Comma(', '));
        return colors.Brace('{') + items + colors.Brace('}');
      }
      const items = keys
        .map(
          key =>
            `${spaces}  ${colors.StringKey(JSON.stringify(key))}${colors.Colon(': ')}${colorizeValue(value[key], indent + 1)}`
        )
        .join(colors.Comma(',\n'));
      return colors.Brace('{') + '\n' + items + '\n' + spaces + colors.Brace('}');
    }

    return String(value);
  }

  return colorizeValue(obj);
}

export class JsonLoader extends Loader<typeof JsonLoader> {
  static override source = 'json';
  static override schema = z.object({
    output: z.string().optional().describe('Output file path (default: stdout)'),
  });

  private stream: NodeJS.WritableStream | NodeJS.WriteStream;
  private jsonTheme?: JsonColorTheme;
  private isFirstWrite = true;
  private isStdoutMode: boolean;

  constructor(
    config: z.input<typeof JsonLoader.schema> = {},
    jsonTheme?: JsonColorTheme,
    isStdoutMode?: boolean
  ) {
    super(config);
    this.stream = process.stdout; // Always use stdout for non-file output
    this.jsonTheme = jsonTheme;
    this.isStdoutMode = isStdoutMode || false;
  }

  async load(record: Record): Promise<LoadResult> {
    const jsonText = JSON.stringify(record.data, null, 2) + '\n';

    if (this.config.output) {
      // Write to file - overwrite on first write, append afterwards
      if (this.isFirstWrite) {
        writeFileSync(this.config.output, jsonText);
        this.isFirstWrite = false;
      } else {
        appendFileSync(this.config.output, jsonText);
      }
    } else if (process.stdout.isTTY && !this.isStdoutMode) {
      // Write to stdout with colorization and cursor control - only when not in stdout extraction mode
      const colorizedJson = colorizeJson(record.data, this.jsonTheme);
      process.stdout.write(cursor.eraseLine);
      process.stdout.write(colorizedJson + '\n');
      process.stdout.write(cursor.moveToStart);
    } else {
      // Being piped or in stdout extraction mode - just write the message without cursor controls
      const jsonOutput =
        process.stdout.isTTY && this.jsonTheme
          ? colorizeJson(record.data, this.jsonTheme) + '\n'
          : jsonText;
      this.stream.write(jsonOutput);
      // Ensure output is flushed immediately, especially when piped
      if (!process.stdout.isTTY) {
        // @ts-ignore - flush method exists on stdout
        this.stream.flush?.();
      }
    }

    return { success: true, record };
  }
}

const cursor = {
  save: '\u001B7',
  restore: '\u001B8',
  moveUp: '\u001B[1A',
  eraseLine: '\u001B[2K',
  moveToStart: '\r',
};
