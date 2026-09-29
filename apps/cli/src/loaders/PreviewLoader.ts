import chalk from 'chalk';
import { z } from 'zod';
import { Loader, type LoadResult, type Record } from '@chronicle.app/etl';

// Properties that name a node, tried in order for its one-line label.
const LABELS = ['name', 'title', 'headline', 'handle', 'text', 'url'];
const MAX_DEPTH = 4;
const MAX_ITEMS = 5;
const MAX_TEXT = 100;

const isNode = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

function text(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const line = s.replaceAll(/\s+/g, ' ').trim();
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT - 1)}…` : line;
}

/** A node's heading: its type, its label, and when it happened. */
function heading(node: { [key: string]: unknown }): { line: string; used: Set<string> } {
  const used = new Set<string>();
  const parts: string[] = [];
  if (typeof node['@type'] === 'string') parts.push(chalk.bold(node['@type']));
  const label = LABELS.find(key => typeof node[key] === 'string' && node[key] !== '');
  if (label) {
    parts.push(`"${text(node[label])}"`);
    used.add(label);
  }
  if (node.timestamp) {
    parts.push(chalk.dim(text(node.timestamp)));
    used.add('timestamp');
  }
  return { line: parts.join(' '), used };
}

/** The lines under a node: its remaining properties, nested nodes indented. */
function body(node: { [key: string]: unknown }, used: Set<string>, depth: number): string[] {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);
  for (const [key, value] of Object.entries(node)) {
    // `@key`, `@asserts` and the like are bookkeeping; `source` is on every node.
    if (
      key.startsWith('@') ||
      key === 'source' ||
      used.has(key) ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values.slice(0, MAX_ITEMS)) {
      if (isNode(item) && depth < MAX_DEPTH) {
        const nested = heading(item);
        lines.push(
          `${indent}${chalk.dim(`${key}:`)} ${nested.line}`,
          ...body(item, nested.used, depth + 1)
        );
      } else {
        lines.push(`${indent}${chalk.dim(`${key}:`)} ${text(item)}`);
      }
    }
    if (values.length > MAX_ITEMS) {
      lines.push(`${indent}${chalk.dim(`${key}: … ${values.length - MAX_ITEMS} more`)}`);
    }
  }
  return lines;
}

/**
 * `--preview`: each record as a short outline, for reading output while
 * working on a plugin. Not meant to be parsed; use the json loader for that.
 */
export class PreviewLoader extends Loader<typeof PreviewLoader> {
  static override source = 'preview';
  static override schema = z.object({});

  private count = 0;

  async load(record: Record): Promise<LoadResult> {
    const data = record.data as { [key: string]: unknown };
    const { line, used } = heading(data);
    const lines = [line || chalk.bold(record.extraction.recordType), ...body(data, used, 1)];
    process.stdout.write(`${this.count++ > 0 ? '\n' : ''}${lines.join('\n')}\n`);
    return { success: true, record };
  }
}
