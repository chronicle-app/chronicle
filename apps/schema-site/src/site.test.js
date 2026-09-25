import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { BaseAndChildrenSchema } from '../../../core/schema/dist/index.js';
import { buildSite } from './build.js';
import { loadSchema } from './model.js';

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
  const schema = await loadSchema();
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

test('the built site has a page for every term and no broken links', async () => {
  const output = mkdtempSync(join(tmpdir(), 'chronicle-schema-site-'));
  try {
    const { pages } = await buildSite(output);
    const schema = await loadSchema();
    for (const name of [...schema.classes.keys(), ...schema.properties.keys()]) {
      assert.ok(
        pages.some(page => page.title === name && page.kind !== 'guide'),
        name
      );
    }
    for (const page of pages) {
      const html = readFileSync(join(output, page.path), 'utf8');
      assert.doesNotMatch(html, /\{root\}/, `${page.path} has an unresolved link`);
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
      assert.equal(ids.size, [...html.matchAll(/\bid="/g)].length, `${page.path}: duplicate id`);
      for (const [, reference] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(reference)) continue;
        const [path, fragment] = reference.split('#');
        // Root-relative links, as on the 404 page, resolve from the site root.
        const base = path.startsWith('/') ? output : dirname(join(output, page.path));
        const target = path ? resolve(base, path.replace(/^\//, '')) : null;
        assert.ok(!target || existsSync(target), `${page.path} links to missing ${reference}`);
        if (fragment && !path) assert.ok(ids.has(fragment), `${page.path}: missing #${fragment}`);
      }
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('descriptions are escaped and :term references become links', async () => {
  const { renderSite } = await import('./render.js');
  const schema = await loadSchema({ ontology: vocabulary, examples: sample('[ a :Thing ]') });
  const guides = [{ slug: 'g', number: 1, title: 'G', lead: 'G', html: '', headings: [] }];
  const page = renderSite(schema, guides).find(entry => entry.path === 'classes/Thing.html');
  assert.match(page.document, /Uses <a class="term property" href="..\/properties\/label.html">/);
  assert.match(page.document, /&lt;b&gt;bold&lt;\/b&gt;/);
  // Required comes from owl:minCardinality, not a default.
  assert.match(
    page.document,
    /tags<\/a> <span class="tag tag-many"[^>]*>many<\/span> <span class="tag tag-required">required/
  );
  assert.doesNotMatch(
    page.document,
    /label<\/a> <span class="tag">one<\/span> <span class="tag tag-required">/
  );
});
