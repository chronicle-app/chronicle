import type { Extractor } from './extractor.js';
import type { Transformer } from './transformer.js';

/**
 * Shapes: what a plugin's transformer makes of its source's records, read
 * from the transformer's actual output rather than its code. Run the plugin's
 * extractors over its test fixtures, keep each record beside what it became,
 * and summarize both: per record type, every input path, every output node
 * and property, and which input each output value came from. A plugin keeps
 * the rendering in its SHAPES.md, so a change to its graph shows up in review
 * as a diff of that file.
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

type Kind = 'text' | 'number' | 'boolean' | 'date' | 'null';

function kindOf(value: unknown): Kind {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

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
  kinds: Set<string>;
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
  samples: number;
  input: Map<string, { kinds: Set<string>; present: number }>;
  output: Map<string, NodeShape>;
}

export interface Shapes {
  recordTypes: Map<string, RecordTypeShape>;
  /** `Type —property→ Type`, across every record type. */
  edges: Set<string>;
}

/** Fields every node carries for identity and bookkeeping, not as content. */
const BOOKKEEPING = new Set(['@type', '@key', '@assertedAt']);

/** Summarize what each record type's records looked like and became. */
export function shapesOf(samples: ShapeSample[]): Shapes {
  const shapes: Shapes = { recordTypes: new Map(), edges: new Set() };
  for (const sample of samples) {
    let shape = shapes.recordTypes.get(sample.recordType);
    if (!shape) {
      shape = { samples: 0, input: new Map(), output: new Map() };
      shapes.recordTypes.set(sample.recordType, shape);
    }
    shape.samples++;

    const inputs = new Map<string, unknown[]>();
    leaves(sample.input, '', inputs);
    for (const [path, values] of inputs) {
      let entry = shape.input.get(path);
      if (!entry) {
        entry = { kinds: new Set(), present: 0 };
        shape.input.set(path, entry);
      }
      for (const value of values) {
        entry.kinds.add(Array.isArray(value) ? 'empty list' : kindOf(value));
      }
      if (values.some(value => value !== null && value !== undefined)) entry.present++;
    }
    // The context explains outputs, but isn't the source's own shape.
    leaves(sample.context ?? {}, 'context', inputs);

    for (const output of sample.outputs) addNode(shape.output, shapes.edges, output, '', inputs);
  }
  return shapes;
}

function addNode(
  nodes: Map<string, NodeShape>,
  edges: Set<string>,
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
  const type = String(node['@type'] ?? 'object');
  shape.types.add(type);
  if (Array.isArray(node['@key'])) shape.keys.add(node['@key'].join(', '));
  shape.count++;

  for (const [name, value] of Object.entries(node)) {
    if (BOOKKEEPING.has(name) || value === undefined) continue;
    let property = shape.properties.get(name);
    if (!property) {
      property = { kinds: new Set(), present: 0, list: false, occurrences: [] };
      shape.properties.set(name, property);
    }
    property.present++;
    const values = Array.isArray(value) ? value : [value];
    if (Array.isArray(value)) property.list = true;
    const childPath = `${path ? `${path}.` : ''}${name}${Array.isArray(value) ? '[]' : ''}`;
    for (const item of values) {
      if (isNode(item)) {
        const target = String(item['@type'] ?? 'object');
        property.kinds.add(`→ ${target}`);
        edges.add(`${type} —${name}→ ${target}`);
        addNode(nodes, edges, item, childPath, inputs);
      } else {
        property.kinds.add(kindOf(item));
        property.occurrences.push({ value: item, sources: sourcesOf(item, inputs) });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering.

const code = (text: string) => `\`${text}\``;
const cell = (text: string) => text.replaceAll('|', '\\|');

function presence(present: number, total: number): string {
  return present === total ? 'always' : 'sometimes';
}

/** The summary as Markdown, for a plugin's SHAPES.md. */
export function renderShapes(shapes: Shapes, { title }: { title: string }): string {
  const lines = [
    `# ${title} shapes`,
    '',
    'Generated from what the transformer makes of the test fixtures. Do not edit:',
    'run `npm run shapes` in this plugin to update it.',
    '',
    'For each record type: the paths in its input, the nodes in its output, and',
    'where each output value came from. `[]` is any list element. A value is',
    'copied from an input path; converted (`String`, `lower`, `date`, `unix`);',
    'built around one (`…{path}…`, as a URL around an id); from a different',
    'path each time (`varies`); always the same (`= value`, `seen once` when',
    'the fixtures show it once); or `computed` in the transformer.',
    '',
    '## Graph',
    '',
    ...[...shapes.edges].sort().map(edge => `- ${edge}`),
  ];

  for (const [recordType, shape] of shapes.recordTypes) {
    lines.push(
      '',
      `## ${recordType}`,
      '',
      '### Input',
      '',
      '| Path | Value | Present |',
      '| --- | --- | --- |'
    );
    for (const [path, entry] of shape.input) {
      lines.push(
        `| ${code(path || '(record)')} | ${cell([...entry.kinds].join(' | '))} | ${presence(entry.present, shape.samples)} |`
      );
    }

    lines.push('', '### Output');
    for (const [path, node] of shape.output) {
      const types = [...node.types].map(type => code(type)).join(' | ');
      lines.push('', `#### ${path ? `${code(path)} → ${types}` : types}`, '');
      if (node.keys.size > 0) {
        lines.push(`Key: ${[...node.keys].map(key => code(key)).join(' or ')}`, '');
      }
      lines.push('| Property | Value | Present | From |', '| --- | --- | --- | --- |');
      for (const [name, property] of node.properties) {
        const kinds = [...property.kinds].join(' | ');
        const value = property.list ? `list of ${kinds}` : kinds;
        const from = property.occurrences.length > 0 ? lineage(property.occurrences) : '';
        lines.push(
          `| ${code(name)} | ${cell(value)} | ${presence(property.present, node.count)} | ${cell(from)} |`
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
