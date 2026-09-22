import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderDocumentation } from './generate-docs.js';

const fixture = `
@prefix : <https://schema.chronicle.app/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
: a owl:Ontology; owl:versionInfo "0.2.0" .
:Base a rdfs:Class .
:Child a rdfs:Class; rdfs:subClassOf :Base;
  rdfs:comment "Uses :label, :Unknown, and <script>alert('x')</script>." .
:Text a rdfs:Class .
:label a rdf:Property; :domainIncludes :Base; :rangeIncludes :Text;
  owl:minCardinality 1; owl:maxCardinality 1 .
:related a rdf:Property; :domainIncludes :Child; :rangeIncludes :Base, :Text .
`;

test('HTML documents inherited fields, ranges, cardinality, and safely linked descriptions', async () => {
  const html = await renderDocumentation(fixture, '0.2.0');
  const child = html.match(/<section class="term" id="Child">([\s\S]*?)<\/section>/)[1];
  assert.match(child, /Inherited properties/);
  assert.match(child, /href="#label"/);
  assert.match(child, /1…1/);
  assert.match(child, /0…unbounded/);
  assert.match(child, /href="#Base"/);
  assert.match(child, /href="#Text"/);
  assert.match(child, /Uses <a href="#label">:label<\/a>/);
  assert.match(child, /:Unknown/);
  assert.match(child, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|href="#Unknown"/);
  assert.match(html, /Vocabulary version 0\.2\.0/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(target), `Broken fragment link: ${target}`);
  }
});

test('HTML generation rejects inheritance cycles and missing parents', async () => {
  await assert.rejects(
    renderDocumentation(fixture + '\n:Base rdfs:subClassOf :Child .', '0.1.0'),
    /Cyclic class inheritance/
  );
  await assert.rejects(
    renderDocumentation(fixture + '\n:Base rdfs:subClassOf :Missing .', '0.1.0'),
    /Undeclared parent/
  );
});

test('HTML generation is deterministic and matches the committed reference', async () => {
  const ttl = readFileSync(new URL('../chronicle.ttl', import.meta.url), 'utf8');
  const html = await renderDocumentation(ttl);
  assert.equal(html, await renderDocumentation(ttl));
  assert.equal(html, readFileSync(new URL('../docs/schema.html', import.meta.url), 'utf8'));
});
