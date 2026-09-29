import { z } from 'zod';

/** A cell: what a column holds for one record. Dates stay dates so each loader can format them. */
export type Cell = string | number | boolean | Date;

// Properties that name a node, tried in order for its one-line label.
export const LABELS = ['name', 'title', 'headline', 'handle', 'text', 'body', 'url'];

const isNode = (value: unknown): value is { [key: string]: unknown } =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** A node's label: its first naming property, else the label of what it acts on. */
export function nodeLabel(node: { [key: string]: unknown }): string | undefined {
  const key = LABELS.find(k => typeof node[k] === 'string' && node[k] !== '');
  if (key) return node[key] as string;
  return isNode(node.object) ? nodeLabel(node.object) : undefined;
}

/**
 * Keys a person reading rows has no use for: JSON-LD bookkeeping (`@key`,
 * `@assertedAt`, …) everywhere, and on a Chronicle node (one with an
 * `@type`) the `source` and `sameAs` every node carries.
 */
function skipped(key: string, node: { [key: string]: unknown }, top: boolean): boolean {
  if (key === '@type') return !top;
  if (key.startsWith('@')) return true;
  return '@type' in node && (key === 'source' || key === 'sameAs');
}

function itemText(item: unknown): string {
  if (item instanceof Date) return item.toISOString();
  if (isNode(item)) return nodeLabel(item) ?? (item['@type'] as string) ?? JSON.stringify(item);
  return String(item);
}

/** Fills `row`; true when it left out schema properties that `schema` mode would keep. */
function collect(
  node: { [key: string]: unknown },
  prefix: string,
  row: Map<string, Cell>,
  top: boolean
): boolean {
  let collapsed = false;
  for (const [key, value] of Object.entries(node)) {
    if (value === null || value === undefined) continue;
    if (skipped(key, node, top)) {
      if (key === '@type' || !key.startsWith('@')) collapsed = true;
      continue;
    }
    const column = prefix + key;
    if (Array.isArray(value)) {
      if (value.length > 0) row.set(column, value.map(item => itemText(item)).join('; '));
      if (value.some(item => isNode(item))) collapsed = true;
    } else if (isNode(value)) {
      const label = nodeLabel(value);
      if (label === undefined) collapsed = collect(value, `${column}.`, row, false) || collapsed;
      else {
        row.set(column, label);
        collapsed = true;
      }
    } else {
      row.set(column, value as Cell);
    }
  }
  return collapsed;
}

/**
 * `readable` shows each nested node as its label; `schema` keeps every
 * Chronicle schema property as its own dotted column (`agent.handle`,
 * `agent.memberOf.handle`), leaving out only JSON-LD bookkeeping.
 */
export type ColumnMode = 'readable' | 'schema';

/** The `--columns` option the CSV and table loaders share. */
export const columnsOption = z
  .enum(['readable', 'schema'])
  .default('readable')
  .describe('readable: nested nodes as labels; schema: every schema property as a dotted column');

function collectSchema(node: { [key: string]: unknown }, prefix: string, row: Map<string, Cell>) {
  for (const [key, value] of Object.entries(node)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('@') && key !== '@type') continue;
    const column = prefix + key;
    if (Array.isArray(value)) {
      // A list of nodes spreads like a single node, each column joining its items.
      const items = new Map<string, string[]>();
      for (const item of value) {
        const inner = new Map<string, Cell>();
        if (isNode(item)) collectSchema(item, `${column}.`, inner);
        else inner.set(column, itemText(item));
        for (const [k, v] of inner) items.set(k, [...(items.get(k) ?? []), cellString(v)]);
      }
      for (const [k, texts] of items) row.set(k, texts.join('; '));
    } else if (isNode(value)) {
      collectSchema(value, `${column}.`, row);
    } else {
      row.set(column, value as Cell);
    }
  }
}

const cellString = (cell: Cell) => (cell instanceof Date ? cell.toISOString() : String(cell));

/**
 * One record as a row of columns. Readable (the default): a nested node
 * becomes its label (`agent` → the person's handle), a node without one
 * spreads into dotted columns, and a list joins its items with `; `.
 */
export function recordRow(data: unknown, mode: ColumnMode = 'readable'): Map<string, Cell> {
  return readRow(data, mode).row;
}

function readRow(data: unknown, mode: ColumnMode) {
  const row = new Map<string, Cell>();
  let collapsed = false;
  if (!isNode(data)) row.set('value', itemText(data));
  else if (mode === 'schema') collectSchema(data, '', row);
  else collapsed = collect(data, '', row, true);
  return { row, collapsed };
}

/** Rows buffered with the union of their columns, in first-seen order. */
export class Rows {
  readonly columns: string[] = [];
  readonly rows: Map<string, Cell>[] = [];
  /** Readable mode left schema properties out of some row: `schema` mode would show more. */
  collapsed = false;
  private seen = new Set<string>();
  private readonly mode: ColumnMode;

  constructor(mode: ColumnMode = 'readable') {
    this.mode = mode;
  }

  add(data: unknown): void {
    const { row, collapsed } = readRow(data, this.mode);
    if (collapsed) this.collapsed = true;
    for (const column of row.keys()) {
      if (!this.seen.has(column)) {
        this.seen.add(column);
        this.columns.push(column);
      }
    }
    this.rows.push(row);
  }
}
