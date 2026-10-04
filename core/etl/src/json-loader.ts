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

const defaultTheme: JsonColorTheme = {
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

const noColor = (text: string) => text;
const plainTheme = Object.fromEntries(
  Object.keys(defaultTheme).map(key => [key, noColor])
) as unknown as JsonColorTheme;

/** Lines no longer than this put short arrays and objects on one line. */
const WIDTH = 100;

// What JSON.stringify would write for a value: dates as ISO strings (null if
// invalid), and undefined or functions left out of objects and null in arrays.
function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return value;
}

const omitted = (value: unknown) => value === undefined || typeof value === 'function';

function entries(value: object): [string, unknown][] {
  return Object.entries(value)
    .map(([key, item]) => [key, jsonValue(item)] as [string, unknown])
    .filter(([, item]) => !omitted(item));
}

function scalar(value: unknown, c: JsonColorTheme): string {
  if (value === null || omitted(value)) return c.NullLiteral('null');
  if (typeof value === 'string') return c.StringLiteral(JSON.stringify(value));
  if (typeof value === 'number') {
    return Number.isFinite(value) ? c.NumberLiteral(String(value)) : c.NullLiteral('null');
  }
  if (typeof value === 'boolean') return c.BooleanLiteral(String(value));
  return c.StringLiteral(JSON.stringify(String(value)));
}

/** A value on one line: `["a", "b"]`, `{ "@type": "Realm", "handle": "am5" }`. */
function inline(value: unknown, c: JsonColorTheme): string {
  value = jsonValue(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return c.Bracket('[]');
    const items = value.map(item => inline(jsonValue(item), c)).join(c.Comma(', '));
    return c.Bracket('[') + items + c.Bracket(']');
  }
  if (typeof value === 'object' && value !== null) {
    const fields = entries(value);
    if (fields.length === 0) return c.Brace('{}');
    const items = fields
      .map(([key, item]) => c.StringKey(JSON.stringify(key)) + c.Colon(': ') + inline(item, c))
      .join(c.Comma(', '));
    return c.Brace('{ ') + items + c.Brace(' }');
  }
  return scalar(value, c);
}

const isContainer = (value: unknown) => typeof value === 'object' && value !== null;

/** Strings, numbers and the like packed onto as few lines as fit, as a list of `@key` paths. */
function fill(items: unknown[], c: JsonColorTheme, indent: string): string[] {
  const lines: string[] = [];
  let line = '';
  let used = 0;
  for (const item of items) {
    const text = scalar(jsonValue(item), c);
    const width = scalar(jsonValue(item), plainTheme).length;
    // Each item but the last on a line is followed by `, `; the last by `,`.
    if (line !== '' && used + 2 + width + 1 > WIDTH) {
      lines.push(line);
      line = '';
    }
    if (line === '') {
      line = indent + text;
      used = indent.length + width;
    } else {
      line += c.Comma(', ') + text;
      used += 2 + width;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * A value laid out over lines, two-space indented. An array or object that
 * fits in what's left of its line stays on that line; the record itself
 * (`depth` 0) always opens up, so each record starts its own block.
 */
function block(value: unknown, c: JsonColorTheme, indent: string, used: number, depth = 0): string {
  value = jsonValue(value);
  if (typeof value !== 'object' || value === null) return scalar(value, c);
  // The trailing comma a nested value may need counts against the width.
  if (depth > 0 && used + inline(value, plainTheme).length + 1 <= WIDTH) return inline(value, c);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return c.Bracket('[]');
    const lines = value.every(item => !isContainer(jsonValue(item)))
      ? fill(value, c, inner)
      : value.map(item => inner + block(item, c, inner, inner.length, depth + 1));
    return `${c.Bracket('[')}\n${lines.join(c.Comma(',\n'))}\n${indent}${c.Bracket(']')}`;
  }
  const fields = entries(value);
  if (fields.length === 0) return c.Brace('{}');
  const items = fields.map(([key, item]) => {
    const name = `${JSON.stringify(key)}: `;
    const rendered = block(item, c, inner, inner.length + name.length, depth + 1);
    return inner + c.StringKey(JSON.stringify(key)) + c.Colon(': ') + rendered;
  });
  return `${c.Brace('{')}\n${items.join(c.Comma(',\n'))}\n${indent}${c.Brace('}')}`;
}

/**
 * JSON for reading: indented like `JSON.stringify(value, null, 2)`, but
 * arrays and objects that fit within 100 columns stay on one line, so
 * `@key` lists and small nodes don't take a line per item. Parses to the
 * same value. Pass a theme to color it.
 */
export function formatJson(value: unknown, theme: JsonColorTheme = plainTheme): string {
  return block(value, theme, '', 0);
}

export function colorizeJson(obj: unknown, theme?: JsonColorTheme, singleLine?: boolean): string {
  const colors = theme || defaultTheme;
  return singleLine ? inline(obj, colors) : formatJson(obj, colors);
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
    const jsonText = formatJson(record.data) + '\n';

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
