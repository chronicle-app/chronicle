// Checks pasted records against the generated Zod schemas. Runs in the
// validator page and in tests, so it takes the schema rather than importing it.
import { toChronicle } from './example-payload.js';

const VOCABULARY = 'https://schema.chronicle.app/';

/** A Zod issue path as it would be written in code, such as `object.url` or `[0].agent`. */
export function formatPath(path) {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : index === 0 ? part : `.${part}`
    )
    .join('');
}

const at = (value, path) => path.reduce((node, part) => node?.[part], value);

function explain(issue, record) {
  switch (issue.code) {
    case 'invalid_union_discriminator': {
      const type = at(record, issue.path);
      return type === undefined
        ? 'Missing @type. Every record, including nested ones, names its class.'
        : `${JSON.stringify(type)} is not a class in this vocabulary, or not one allowed here.`;
    }
    case 'custom':
      return 'Missing @key or @id. Every record, including nested ones, declares its identity.';
    case 'invalid_type':
      if (issue.received === 'undefined') return 'Required.';
      if (issue.expected === 'object') {
        return `Expected a nested record with its own @type and @key or @id, not ${issue.received}.`;
      }
      if (issue.expected === 'array') return `Expected a list, not ${issue.received}.`;
      return `Expected ${issue.expected}, not ${issue.received}.`;
    case 'invalid_string':
      return issue.validation === 'url' ? 'Not an absolute URL.' : issue.message;
    case 'invalid_date':
      return 'Not a date and time. Use an ISO 8601 string, such as 2026-03-14T09:26:00Z.';
    default:
      return issue.message;
  }
}

// Zod drops fields a type does not declare, so any field missing from the
// parsed record was not declared.
function undeclared(input, output, path, found) {
  if (Array.isArray(input) && Array.isArray(output)) {
    for (const [index, item] of input.entries())
      undeclared(item, output[index], [...path, index], found);
  } else if (input && typeof input === 'object' && output && typeof output === 'object') {
    if (output instanceof Date) return found;
    for (const [key, value] of Object.entries(input)) {
      if (key in output) undeclared(value, output[key], [...path, key], found);
      else
        found.push({
          path: [...path, key],
          target: 'field',
          message: `Not declared for ${output['@type']}, so it is dropped.`,
        });
    }
  }
  return found;
}

// The JSON-LD the site shows compacts terms against the vocabulary; Chronicle
// JSON is the same records without the context.
function fromJsonLd(value) {
  const vocab = value['@context']?.['@vocab'];
  if (vocab !== VOCABULARY) {
    throw new Error(`JSON-LD must use "@vocab": "${VOCABULARY}" in its @context.`);
  }
  return toChronicle('@graph' in value ? value['@graph'] : value);
}

/**
 * Where a path into the checked records points in the pasted document. JSON-LD
 * keeps its records under @graph when there are several, and lists key fields
 * as doc:key's @list.
 */
export function sourcePath(path, { jsonld = false, graph = false } = {}) {
  const source = jsonld && graph ? ['@graph', ...path] : [...path];
  if (!jsonld) return source;
  return source.flatMap((part, index) =>
    part === '@key'
      ? typeof source[index + 1] === 'number'
        ? ['doc:key', '@list']
        : ['doc:key']
      : [part]
  );
}

const written = (issues, source) =>
  issues.map(({ at, ...issue }) => ({
    ...issue,
    path: formatPath(issue.path),
    location: sourcePath(at ?? issue.path, source),
  }));

/**
 * Validates `text`, one record or a list of records in Chronicle JSON or the
 * site's JSON-LD, against `schema` (BaseAndChildrenSchema). Returns the
 * outcome with any errors and warnings, each with a path.
 */
export function validateRecords(text, schema) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { status: 'unreadable', message: `Not valid JSON: ${error.message}` };
  }
  const format = value && typeof value === 'object' && '@context' in value ? 'jsonld' : 'chronicle';
  const source = { jsonld: format === 'jsonld', graph: format === 'jsonld' && '@graph' in value };
  try {
    if (format === 'jsonld') value = fromJsonLd(value);
  } catch (error) {
    return { status: 'unreadable', format, message: error.message };
  }
  const list = Array.isArray(value);
  const records = list ? value : [value];
  if (records.length === 0)
    return { status: 'unreadable', format, message: 'The list has no records.' };

  const errors = [];
  const warnings = [];
  const types = [];
  for (const [index, record] of records.entries()) {
    const prefix = list ? [index] : [];
    const result = schema.safeParse(record);
    if (result.success) {
      types.push(result.data['@type']);
      undeclared(record, result.data, prefix, warnings);
      continue;
    }
    for (const issue of result.error.issues) {
      const path = [...prefix, ...issue.path];
      const missing = issue.code === 'invalid_type' && issue.received === 'undefined';
      errors.push({
        path,
        // A missing field or identity has no text of its own, so it points at its record.
        target: issue.code === 'custom' || missing ? 'record' : 'value',
        at: missing ? path.slice(0, -1) : path,
        message: explain(issue, record),
      });
    }
  }
  return {
    status: errors.length > 0 ? 'invalid' : 'valid',
    format,
    count: records.length,
    types,
    errors: written(errors, source),
    warnings: written(warnings, source),
  };
}
