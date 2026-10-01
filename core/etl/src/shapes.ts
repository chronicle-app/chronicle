import type { Extractor } from './extractor.js';
import type { Transformer } from './transformer.js';

/**
 * Shapes: what a plugin's transformer makes of its source's records, read
 * from the transformer's actual output rather than its code. Run the plugin's
 * extractors over its test fixtures, keep each record beside what it became,
 * and sketch each record type as a tree of the nodes it becomes, marking the
 * values the transformer computes rather than copies from the record. A
 * plugin keeps the sketch in its SHAPES.md, so a change to its graph shows up
 * in review as a diff of that file.
 */

/** One record and the nodes the transformer made of it. */
export interface ShapeSample {
  recordType: string;
  /** The record's raw payload, in the source's own shape. */
  input: unknown;
  /** What the extractor attached beside it (the account, a parent item). */
  context?: unknown;
  outputs: unknown[];
}

/** Run an extractor to the end and pair each record with its transformation. */
export async function sampleTransform(
  extractor: Extractor,
  transformer: Transformer = extractor.instantiateDefaultTransformer()
): Promise<ShapeSample[]> {
  const samples: ShapeSample[] = [];
  await extractor.setup();
  try {
    for await (const record of extractor.extract()) {
      const outputs = await transformer.performTransform(record);
      const { recordType, key: _key, occurredAt: _at, ...context } = record.context ?? {};
      samples.push({
        recordType: record.extraction.recordType ?? recordType ?? 'records',
        input: record.data,
        context,
        outputs: outputs.map(output => output.data),
      });
    }
  } finally {
    await extractor.teardown();
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Reading values.

function isNode(value: unknown): value is { [key: string]: unknown } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** Every leaf of a payload as `path → values`; `[]` stands for any list element. */
function leaves(value: unknown, path: string, out: Map<string, unknown[]>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) push(out, path, []);
    for (const item of value) leaves(item, `${path}[]`, out);
  } else if (isNode(value)) {
    for (const [name, child] of Object.entries(value)) {
      leaves(child, path ? `${path}.${name}` : name, out);
    }
  } else {
    push(out, path, value);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ---------------------------------------------------------------------------
// Where an output value came from.

/** How an input value can turn into an output value, best first. */
const CONVERSIONS: {
  name: string;
  matches: (input: unknown, output: unknown) => boolean;
  format: (path: string) => string;
}[] = [
  {
    name: 'copy',
    matches: (input, output) =>
      (typeof output === 'string' || typeof output === 'number') && input === output,
    format: path => path,
  },
  {
    name: 'string',
    matches: (input, output) => typeof input === 'number' && String(input) === output,
    format: path => `String(${path})`,
  },
  {
    name: 'lower',
    matches: (input, output) =>
      typeof input === 'string' && input !== output && input.toLowerCase() === output,
    format: path => `lower(${path})`,
  },
  {
    name: 'date',
    matches: (input, output) =>
      output instanceof Date && typeof input === 'string' && Date.parse(input) === output.getTime(),
    format: path => `date(${path})`,
  },
  {
    name: 'within',
    // Built around it, as a URL around an id: `…{id}…`. Short values would
    // turn up inside anything.
    matches: (input, output) =>
      typeof output === 'string' &&
      (typeof input === 'string' || typeof input === 'number') &&
      String(input).length >= 3 &&
      output !== String(input) &&
      output.includes(String(input)),
    format: path => `…{${path}}…`,
  },
  {
    name: 'unix',
    matches: (input, output) =>
      output instanceof Date && typeof input === 'number' && input * 1000 === output.getTime(),
    format: path => `unix(${path})`,
  },
];

/** The input leaves an output value matches, as `rank:formatted`, best first. */
function sourcesOf(output: unknown, inputs: Map<string, unknown[]>): string[] {
  if (output === '' || typeof output === 'boolean') return [];
  const found: string[] = [];
  for (const [rank, conversion] of CONVERSIONS.entries()) {
    for (const [path, values] of inputs) {
      if (!values.some(value => conversion.matches(value, output))) continue;
      // The record's own payload explains a value better than its context.
      const weight = rank * 2 + (path.startsWith('context.') ? 1 : 0);
      found.push(`${weight}:${conversion.format(path)}`);
    }
  }
  return found;
}

const best = (sources: Iterable<string>): string[] => {
  const ranked = [...sources].sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
  const top = ranked[0]?.split(':')[0];
  return ranked.filter(s => s.split(':')[0] === top).map(s => s.slice(s.indexOf(':') + 1));
};

/**
 * Where a property's values came from, across every time it appeared: the
 * input path every value matches, a different input path each time
 * (`varies`), one fixed value (`= "github"`), or nothing in the input
 * (`computed`): a decision made in the transformer's code.
 */
function lineage(occurrences: { value: unknown; sources: string[] }[]): string {
  let common: Set<string> | undefined;
  for (const { sources } of occurrences) {
    common = new Set(common ? sources.filter(s => common!.has(s)) : sources);
  }
  if (common && common.size > 0) return best(common).slice(0, 3).join(' | ');
  if (occurrences.every(o => o.sources.length > 0)) {
    const each = [...new Set(occurrences.flatMap(o => best(o.sources)))];
    return `varies: ${each.slice(0, 4).join(' | ')}${each.length > 4 ? ' | …' : ''}`;
  }
  // One sighting can't show that a value never changes, so it says so.
  const values = new Set(occurrences.map(o => JSON.stringify(o.value)));
  if (values.size === 1) {
    return `= ${[...values][0]}${occurrences.length === 1 ? ' (seen once)' : ''}`;
  }
  return 'computed';
}

// ---------------------------------------------------------------------------
// Summaries.

interface PropertyShape {
  /** Whether its values are nodes (rendered as children) rather than plain values. */
  nodes: boolean;
  present: number;
  list: boolean;
  occurrences: { value: unknown; sources: string[] }[];
}

interface NodeShape {
  types: Set<string>;
  keys: Set<string>;
  count: number;
  properties: Map<string, PropertyShape>;
}

interface RecordTypeShape {
  /** Output nodes by where they sit: `''` is the action, `object.author[]` an author of its object. */
  output: Map<string, NodeShape>;
}

export interface Shapes {
  recordTypes: Map<string, RecordTypeShape>;
}

/** Fields every node carries for identity and bookkeeping, not as content. */
const BOOKKEEPING = new Set(['@type', '@key', '@assertedAt']);

/** Summarize what each record type's records became, and from what. */
export function shapesOf(samples: ShapeSample[]): Shapes {
  const shapes: Shapes = { recordTypes: new Map() };
  for (const sample of samples) {
    let shape = shapes.recordTypes.get(sample.recordType);
    if (!shape) {
      shape = { output: new Map() };
      shapes.recordTypes.set(sample.recordType, shape);
    }
    const inputs = new Map<string, unknown[]>();
    leaves(sample.input, '', inputs);
    leaves(sample.context ?? {}, 'context', inputs);
    for (const output of sample.outputs) addNode(shape.output, output, '', inputs);
  }
  return shapes;
}

function addNode(
  nodes: Map<string, NodeShape>,
  node: unknown,
  path: string,
  inputs: Map<string, unknown[]>
): void {
  if (!isNode(node)) return;
  let shape = nodes.get(path);
  if (!shape) {
    shape = { types: new Set(), keys: new Set(), count: 0, properties: new Map() };
    nodes.set(path, shape);
  }
  shape.types.add(String(node['@type'] ?? 'object'));
  if (Array.isArray(node['@key'])) shape.keys.add(keyLabel(node['@key'] as string[]));
  shape.count++;

  for (const [name, value] of Object.entries(node)) {
    if (BOOKKEEPING.has(name) || value === undefined) continue;
    let property = shape.properties.get(name);
    if (!property) {
      property = { nodes: false, present: 0, list: false, occurrences: [] };
      shape.properties.set(name, property);
    }
    property.present++;
    if (Array.isArray(value)) property.list = true;
    const childPath = `${path ? `${path}.` : ''}${name}${Array.isArray(value) ? '[]' : ''}`;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (isNode(item)) {
        property.nodes = true;
        addNode(nodes, item, childPath, inputs);
      } else {
        property.occurrences.push({ value: item, sources: sourcesOf(item, inputs) });
      }
    }
  }
}

/**
 * A key without the `@type` and `source` nearly every key starts with; a key
 * without `source` is shared across sources, which matters, so it says so.
 */
function keyLabel(key: string[]): string {
  const fields = key.filter(field => field !== '@type' && field !== 'source');
  const shared = key.includes('source') ? '' : ', any source';
  return `${fields.join(' + ') || '@type'}${shared}`;
}

// ---------------------------------------------------------------------------
// Rendering.

/** Properties every node has, which a sketch can leave out. */
const UNREMARKABLE = new Set(['source']);

/**
 * The summary as a tree per record type, for a plugin's SHAPES.md: each node's
 * type and key, then its plain properties, then its nested nodes, indented.
 *
 *   PublishAction (sourceId): sourceId, timestamp
 *     agent → Agent (handle): handle, url, sameAs?
 *     object → Post (sourceId): sourceId, url, name, body?
 */
export function renderShapes(shapes: Shapes, { title }: { title: string }): string {
  const lines = [
    `# ${title} shapes`,
    '',
    'What each record type becomes, from the transformer’s output for the test',
    'fixtures. Generated: run `npm run shapes` in this plugin to update it.',
    '',
    'Each line is a node: its type, its key in parentheses (after `@type` and',
    '`source`), and its properties. `?` marks a property that is sometimes',
    'absent, `[]` a list, and `*` a value computed in the transformer rather',
    'than copied or converted from the record. Every node also has `source`.',
  ];
  const constants = constantsOf(shapes);
  for (const [recordType, shape] of shapes.recordTypes) {
    lines.push('', `## ${recordType}`, '', '```text');
    renderNode(shape.output, '', '', 0, lines, constants);
    lines.push('```');
  }
  return `${lines.join('\n')}\n`;
}

function renderNode(
  nodes: Map<string, NodeShape>,
  path: string,
  label: string,
  depth: number,
  lines: string[],
  constants: Set<string>
): void {
  const node = nodes.get(path);
  if (!node) return;
  const types = [...node.types].join(' | ');
  const keys = node.keys.size > 0 ? ` (${[...node.keys].join(' / ')})` : '';
  const plain: string[] = [];
  const nested: [string, string][] = [];
  for (const [name, property] of node.properties) {
    const marks = `${property.list ? '[]' : ''}${property.present < node.count ? '?' : ''}`;
    if (property.nodes) {
      nested.push([
        `${path ? `${path}.` : ''}${name}${property.list ? '[]' : ''}`,
        `${name}${marks}`,
      ]);
    } else if (!UNREMARKABLE.has(name)) {
      // Seen once and not in the record: a constant only if other record
      // types show it never changes.
      const from = lineage(property.occurrences);
      const once = from.endsWith('(seen once)') && !constants.has(name);
      const computed = from === 'computed' || once ? '*' : '';
      plain.push(`${name}${marks}${computed}`);
    }
  }
  const head = `${'  '.repeat(depth)}${label ? `${label} → ` : ''}${types}${keys}`;
  lines.push(plain.length > 0 ? `${head}: ${plain.join(', ')}` : head);
  for (const [childPath, childLabel] of nested) {
    renderNode(nodes, childPath, childLabel, depth + 1, lines, constants);
  }
}

/** Properties with one value everywhere they appear, across every record type. */
function constantsOf(shapes: Shapes): Set<string> {
  const seen = new Map<string, string[]>();
  for (const shape of shapes.recordTypes.values()) {
    for (const node of shape.output.values()) {
      for (const [name, property] of node.properties) {
        for (const { value } of property.occurrences) push(seen, name, JSON.stringify(value));
      }
    }
  }
  return new Set(
    [...seen]
      .filter(([, values]) => values.length > 1 && new Set(values).size === 1)
      .map(([name]) => name)
  );
}
