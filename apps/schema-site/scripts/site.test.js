import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { BaseAndChildrenSchema } from '../../../core/schema/dist/index.js';
import { loadSchema, readSchema } from '../src/lib/model.js';
import { locateIssues, parseFailure } from '../src/lib/locate.js';
import { validateRecords } from '../src/lib/validate.js';
import { FAILING_PRESETS } from '../src/lib/validator-presets.js';
import { buildSite } from './build.js';
import { DATA_DIRECTORIES } from './directories.js';

const vocabulary = `
@prefix : <https://schema.chronicle.app/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
: a owl:Ontology; owl:versionInfo "0.2.0" .
:Base a rdfs:Class .
:Thing a rdfs:Class; rdfs:subClassOf :Base; rdfs:comment "Uses :label and <b>bold</b>." .
:Text a rdfs:Class .
:label a rdf:Property; :domainIncludes :Thing; :rangeIncludes :Text; owl:maxCardinality 1 .
:tags a rdf:Property; :domainIncludes :Thing; :rangeIncludes :Text; owl:minCardinality 1 .
`;
const prefixes = `
@prefix : <https://schema.chronicle.app/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix doc: <https://schema.chronicle.app/docs/> .
@prefix example: <https://schema.chronicle.app/examples/> .
`;
const sample = body => `${prefixes}
example:one rdfs:label "One"; rdfs:comment "A :Thing."; rdf:value ${body} .
:Thing skos:example example:one .`;

test('examples render as Chronicle JSON, JSON-LD, and nested Turtle', async () => {
  const schema = await loadSchema({
    ontology: vocabulary,
    examples: sample(`[ a :Thing; doc:key ("@type" "label"); :label "A"; :tags "x" ]`),
  });
  const [example] = schema.classes.get('Thing').examples;
  assert.deepEqual(example.chronicle, {
    '@type': 'Thing',
    '@key': ['@type', 'label'],
    label: 'A',
    tags: ['x'],
  });
  assert.deepEqual(example.jsonld['doc:key'], { '@list': ['@type', 'label'] });
  assert.match(example.turtle, /\[\n {2}a :Thing;\n {2}doc:key \("@type" "label"\);/);
  assert.deepEqual(example.usedBy, ['Thing']);
  assert.equal(schema.version, '0.2.0');
});

const read = body => loadSchema({ ontology: vocabulary, examples: sample(body) });

test('examples are validated as they are read', async () => {
  await assert.rejects(read(`[ a :Thing; :label "A", "B" ]`), /exceeds maxCardinality 1/);
  await assert.rejects(read(`[ a :Thing; doc:key () ]`), /doc:key cannot be empty/);
  await assert.rejects(read(`"prose"`), /must be an RDF node/);
  await assert.rejects(
    read(`[ a :Thing; :label _:shared; :tags _:shared ] . _:shared a :Thing`),
    /examples must be trees/
  );
});

test('the class hierarchy and property references must be declared and acyclic', async () => {
  await assert.rejects(
    loadSchema({ ontology: vocabulary + ':Base rdfs:subClassOf :Thing .', examples: prefixes }),
    /Cyclic class inheritance/
  );
  await assert.rejects(
    loadSchema({ ontology: vocabulary + ':Base rdfs:subClassOf :Missing .', examples: prefixes }),
    /Undeclared parent class/
  );
  await assert.rejects(
    loadSchema({
      ontology: vocabulary + ':other a rdf:Property; :rangeIncludes :Missing .',
      examples: prefixes,
    }),
    /refers to undeclared Missing/
  );
});

test('every documentation example is a valid Chronicle record', async () => {
  const schema = await readSchema(DATA_DIRECTORIES.schema);
  assert.ok(schema.examples.length > 0);
  // Chronicle JSON shows dates as ISO strings; plugins emit Date objects.
  const dates = new Set(
    [...schema.properties.values()]
      .filter(property => property.range.includes('DateTime'))
      .map(property => property.name)
  );
  const revive = value =>
    Array.isArray(value)
      ? value.map(item => revive(item))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              dates.has(key) ? new Date(item) : revive(item),
            ])
          )
        : value;
  for (const example of schema.examples) {
    const record = revive(example.chronicle);
    const result = BaseAndChildrenSchema.safeParse(record);
    assert.ok(result.success, `${example.id}: ${result.error?.message}`);
    // Zod strips undeclared fields, so a lossless parse means every field is declared.
    assert.deepEqual(result.data, record, `${example.id} uses fields its types do not declare`);
    assert.ok(example.usedBy.length > 0, `${example.id} is not linked from any term`);
  }
});

test('the validator accepts every example, in Chronicle JSON and JSON-LD', async () => {
  const schema = await readSchema(DATA_DIRECTORIES.schema);
  for (const example of schema.examples) {
    for (const [format, value] of Object.entries({
      chronicle: example.chronicle,
      jsonld: example.jsonld,
    })) {
      const result = validateRecords(JSON.stringify(value), BaseAndChildrenSchema);
      assert.equal(result.format, format, example.id);
      assert.equal(
        result.status,
        'valid',
        `${example.id} (${format}): ${JSON.stringify(result.errors)}`
      );
      assert.deepEqual(result.warnings, [], `${example.id} (${format})`);
    }
  }
});

const issuePaths = result => [...result.errors, ...result.warnings].map(issue => issue.path).sort();

test('the validator reports errors and warnings with their paths', () => {
  const outcomes = Object.fromEntries(
    FAILING_PRESETS.map(preset => [
      preset.id,
      validateRecords(JSON.stringify(preset.value), BaseAndChildrenSchema),
    ])
  );
  assert.deepEqual(issuePaths(outcomes['missing-identity']), ['']);
  assert.deepEqual(issuePaths(outcomes['nested-missing-identity']), ['object']);
  assert.deepEqual(issuePaths(outcomes['unknown-class']), ['@type']);
  assert.deepEqual(issuePaths(outcomes['wrong-values']), ['agent', 'object.url', 'timestamp']);
  assert.equal(outcomes['undeclared-field'].status, 'valid');
  assert.deepEqual(issuePaths(outcomes['undeclared-field']), ['priority']);
  for (const [id, result] of Object.entries(outcomes)) {
    if (id !== 'undeclared-field') assert.equal(result.status, 'invalid', id);
  }

  const list = validateRecords(
    '[{"@type":"Entity","@id":"a"},{"@type":"Entity"}]',
    BaseAndChildrenSchema
  );
  assert.deepEqual(issuePaths(list), ['[1]']);
  assert.equal(validateRecords('{"@type":', BaseAndChildrenSchema).status, 'unreadable');
  assert.equal(
    validateRecords(
      '{"@context":{"@vocab":"https://schema.org/"},"@type":"Thing"}',
      BaseAndChildrenSchema
    ).status,
    'unreadable'
  );
});

// The text each issue in `text` marks.
const marked = text => {
  const result = validateRecords(text, BaseAndChildrenSchema);
  const found = [...result.errors, ...result.warnings];
  return locateIssues(text, found).map(range =>
    text.slice(range.offset, range.offset + range.length)
  );
};

test('the validator finds each issue in the pasted text', () => {
  const presets = Object.fromEntries(
    FAILING_PRESETS.map(preset => [preset.id, marked(JSON.stringify(preset.value, null, 2))])
  );
  // A missing identity marks the record's @type.
  assert.deepEqual(presets['missing-identity'], ['"@type": "Entity"']);
  assert.deepEqual(presets['nested-missing-identity'], ['"@type": "Message"']);
  assert.deepEqual(presets['unknown-class'], ['"ReadAction"']);
  assert.deepEqual(presets['wrong-values'], ['"Sam"', '"renew passport"', '"last Tuesday"']);
  assert.deepEqual(presets['undeclared-field'], ['"priority": "high"']);

  const jsonld = JSON.stringify({
    '@context': {
      '@vocab': 'https://schema.chronicle.app/',
      doc: 'https://schema.chronicle.app/docs/',
    },
    '@graph': [
      { '@type': 'Entity', 'doc:key': { '@list': ['sourceId'] }, sourceId: '1' },
      { '@type': 'Entity', 'doc:key': { '@list': ['sourceId'] }, sourceId: '2', url: 'nope' },
    ],
  });
  assert.deepEqual(marked(jsonld), ['"nope"']);

  assert.deepEqual(parseFailure('{\n  "a": 1,\n  "b" 2\n}'), {
    offset: 18,
    length: 1,
    code: 'ColonExpected',
    line: 3,
    column: 7,
  });
  assert.equal(parseFailure('{"a": 1}'), null);
});

const htmlFiles = directory =>
  readdirSync(directory, { recursive: true })
    .filter(file => file.endsWith('.html'))
    .map(file => join(directory, file));

/**
 * Checks every page under `site`, served from `base`, for duplicate ids, nested
 * links, and links to files or fragments that do not exist.
 */
function checkLinks(site, base = '/') {
  const pages = htmlFiles(site);
  assert.ok(pages.length > 0);
  for (const file of pages) {
    const page = relative(site, file);
    const html = readFileSync(file, 'utf8');
    // Links cannot nest: browsers end the outer link at the first inner one.
    let depth = 0;
    for (const [tag] of html.matchAll(/<\/?a\b/g)) {
      depth += tag === '<a' ? 1 : -1;
      assert.ok(depth <= 1, `${page} has a link inside a link`);
    }
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    assert.equal(ids.size, [...html.matchAll(/\bid="/g)].length, `${page}: duplicate id`);
    for (const [, reference] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:)/.test(reference)) continue;
      const [path, fragment] = reference.split('#');
      if (path.startsWith('/')) {
        assert.ok(path.startsWith(base), `${page} links outside ${base}: ${reference}`);
      }
      const target = path
        ? path.startsWith('/')
          ? join(site, path.slice(base.length))
          : resolve(dirname(file), path)
        : null;
      assert.ok(!target || existsSync(target), `${page} links to missing ${reference}`);
      if (fragment && !path) assert.ok(ids.has(fragment), `${page}: missing #${fragment}`);
    }
  }
}

test('the built site has a page for every term and no broken links', async () => {
  const output = mkdtempSync(join(tmpdir(), 'chronicle-schema-site-'));
  try {
    await buildSite({ output });
    const schema = await readSchema(DATA_DIRECTORIES.schema);
    for (const name of schema.classes.keys()) {
      assert.ok(existsSync(join(output, 'classes', `${name}.html`)), name);
    }
    for (const name of schema.properties.keys()) {
      assert.ok(existsSync(join(output, 'properties', `${name}.html`)), name);
    }
    assert.ok(existsSync(join(output, 'chronicle.ttl')));
    assert.ok(existsSync(join(output, 'assets', 'search-index.js')));
    checkLinks(output);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('a release snapshot links within its own path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'chronicle-schema-site-'));
  // A small vocabulary and guide stand in for the real ones.
  const schemaDirectory = join(root, 'schema');
  const guidesDirectory = join(root, 'guides');
  mkdirSync(schemaDirectory);
  mkdirSync(guidesDirectory);
  writeFileSync(join(schemaDirectory, 'chronicle.ttl'), vocabulary);
  writeFileSync(join(schemaDirectory, 'examples.ttl'), sample('[ a :Thing; :tags "x" ]'));
  writeFileSync(join(guidesDirectory, '01-first.md'), '# First\n\nAbout :Thing and class:Thing.\n');
  const base = '/releases/0.2.0/';
  const output = join(root, 'site');
  try {
    await buildSite({
      output,
      base,
      directories: { schema: schemaDirectory, guides: guidesDirectory },
    });
    checkLinks(output, base);
    const page = readFileSync(join(output, 'classes', 'Thing.html'), 'utf8');
    assert.match(page, /data-root="\/releases\/0\.2\.0\/"/);
    // Term pages link to the schema change form with the term filled in.
    assert.match(
      page,
      /href="[^"]*\/issues\/new\?template=schema-change\.yml[^"]*&amp;term=Thing"/
    );
    // Descriptions are escaped, and :term references become links.
    assert.match(
      page,
      /Uses <a class="term property" href="\/releases\/0\.2\.0\/properties\/label\.html">/
    );
    assert.match(page, /&lt;b&gt;bold&lt;\/b&gt;/);
    // Required comes from owl:minCardinality, not a default.
    assert.match(
      page,
      /tags<\/a>\s+<span class="tag tag-many"[^>]*>many<\/span>\s*<span class="tag tag-required">required/
    );
    assert.doesNotMatch(
      page,
      /label<\/a>\s+<span class="tag">one<\/span>\s*<span class="tag tag-required">/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the schema change form has the fields the site fills in', () => {
  const form = readFileSync(
    new URL('../../../.github/ISSUE_TEMPLATE/schema-change.yml', import.meta.url),
    'utf8'
  );
  assert.match(form, /^\s+id: term$/m);
  assert.match(form, /^title: 'Schema: '$/m);
});
