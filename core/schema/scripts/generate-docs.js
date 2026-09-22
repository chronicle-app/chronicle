import { schemaVersion } from './schema-version.js';
// Adapted from chronicle-internal's schema model and reference renderers.
import { Parser, Store } from 'n3';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import prettierConfig from '@chronicle.app/prettier-config';

const namespace = 'https://schema.chronicle.app/';
const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const rdfs = 'http://www.w3.org/2000/01/rdf-schema#';
const owl = 'http://www.w3.org/2002/07/owl#';
const escape = value =>
  String(value).replaceAll(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );

export async function renderDocumentation(ttl) {
  const version = schemaVersion(ttl);
  const store = new Store(new Parser().parse(ttl));
  const values = (subject, predicate) =>
    store.getQuads(subject, predicate, null).map(quad => quad.object.value);
  const terms = type =>
    store
      .getQuads(null, rdf + 'type', type)
      .map(({ subject }) => ({
        uri: subject.value,
        name: subject.value.slice(namespace.length),
        comment: values(subject, rdfs + 'comment')[0] || '',
      }))
      .filter(term => term.uri.startsWith(namespace))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const classes = terms(rdfs + 'Class').map(term => ({
    ...term,
    parents: values(term.uri, rdfs + 'subClassOf'),
  }));
  const properties = terms(rdf + 'Property').map(term => ({
    ...term,
    domain: values(term.uri, namespace + 'domainIncludes'),
    range: values(term.uri, namespace + 'rangeIncludes'),
    min: values(term.uri, owl + 'minCardinality')[0] || '0',
    max: values(term.uri, owl + 'maxCardinality')[0] || 'unbounded',
  }));
  const allTerms = new Map([...classes, ...properties].map(term => [term.uri, term]));
  const classMap = new Map(classes.map(term => [term.uri, term]));
  const link = uri => {
    const term = allTerms.get(uri);
    return term
      ? `<a href="#${escape(encodeURIComponent(term.name))}">:${escape(term.name)}</a>`
      : `<code>${escape(uri)}</code>`;
  };
  const links = uris => uris.map(uri => link(uri)).join(', ') || 'Not specified';
  // Tokenize before escaping, and link only declared terms, not arbitrary URLs.
  const prose = text =>
    text
      .split(/(`[^`]+`|(?<![\w/:]):[A-Za-z][A-Za-z0-9]*)/g)
      .map(part => {
        if (part.startsWith('`') && part.endsWith('`'))
          return `<code>${escape(part.slice(1, -1))}</code>`;
        if (part.startsWith(':') && allTerms.has(namespace + part.slice(1)))
          return link(namespace + part.slice(1));
        return escape(part);
      })
      .join('');
  const ancestors = (term, path = new Set()) => {
    if (path.has(term.uri)) throw new Error(`Cyclic class inheritance: ${term.name}`);
    const next = new Set([...path, term.uri]);
    return term.parents.flatMap(uri => {
      const parent = classMap.get(uri);
      if (!parent) throw new Error(`Undeclared parent class: ${uri}`);
      return [uri, ...ancestors(parent, next)];
    });
  };
  // Validate every branch, including cycles that have no root in the hierarchy.
  const ancestry = new Map(classes.map(term => [term.uri, new Set(ancestors(term))]));
  const children = uri => classes.filter(term => term.parents.includes(uri));
  const tree = term => {
    const descendants = children(term.uri);
    return `<li>${link(term.uri)}${descendants.length > 0 ? `<ul>${descendants.map(term => tree(term)).join('')}</ul>` : ''}</li>`;
  };
  const table = fields =>
    `<div class="table-wrap"><table><thead><tr><th scope="col">Property</th><th scope="col">Value type</th><th scope="col">Cardinality</th><th scope="col">Declared on</th></tr></thead><tbody>${fields
      .map(
        field => `<tr><td>${link(field.uri)}</td><td>${links(field.range)}</td>
        <td>${escape(field.min)}…${escape(field.max)}</td><td>${links(field.domain)}</td></tr>`
      )
      .join('')}</tbody></table></div>`;
  const heading = (term, kind) => `<header><p class="eyebrow">${kind}</p>
    <h3>${link(term.uri)}</h3></header><p>${prose(term.comment)}</p>`;
  const reference = term => `<p class="uri">URI: <code>${escape(term.uri)}</code></p>`;
  const classSections = classes
    .map(term => {
      const direct = properties.filter(field => field.domain.includes(term.uri));
      const inherited = properties.filter(
        field =>
          !direct.includes(field) && field.domain.some(uri => ancestry.get(term.uri).has(uri))
      );
      return `<section class="term" id="${escape(encodeURIComponent(term.name))}">
      ${heading(term, 'Type')}
      ${term.parents.length > 0 ? `<p><strong>Parent types:</strong> ${links(term.parents)}</p>` : ''}
      ${children(term.uri).length > 0 ? `<p><strong>Subtypes:</strong> ${links(children(term.uri).map(child => child.uri))}</p>` : ''}
      ${direct.length > 0 ? `<h4>Properties defined here</h4>${table(direct)}` : '<p class="muted">No properties declared directly on this type.</p>'}
      ${inherited.length > 0 ? `<h4>Inherited properties</h4>${table(inherited)}` : ''}
      ${reference(term)}</section>`;
    })
    .join('');
  const propertySections = properties
    .map(
      term => `<section class="term" id="${escape(encodeURIComponent(term.name))}">
      ${heading(term, 'Property')}
      <dl><dt>Applies to</dt><dd>${links(term.domain)} and their subtypes</dd>
      <dt>Value type</dt><dd>${links(term.range)}</dd>
      <dt>Cardinality</dt><dd>${escape(term.min)}…${escape(term.max)}</dd></dl>
      ${reference(term)}</section>`
    )
    .join('');
  const css = readFileSync(new URL('docs.css', import.meta.url), 'utf8');
  return prettier.format(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Chronicle vocabulary: types, properties, inheritance, and constraints.">
    <title>Chronicle schema ${escape(version)}</title><style>${css}</style></head><body>
    <a class="skip" href="#reference">Skip to reference</a>
    <aside class="sidebar"><a class="brand" href="#overview">Chronicle</a>
    <p class="muted">Schema reference · ${escape(version)}</p>
    <nav aria-label="Schema navigation"><h2><a href="#types">Types</a></h2>
    <ul class="tree">${classes
      .filter(term => term.parents.length === 0)
      .map(term => tree(term))
      .join('')}</ul>
    <h2><a href="#properties">Properties</a></h2><ul class="tree">${properties.map(term => `<li>${link(term.uri)}</li>`).join('')}</ul></nav></aside>
    <main id="reference"><header id="overview"><p class="eyebrow">Chronicle vocabulary</p>
    <h1>A shared vocabulary for personal history.</h1>
    <p>Reference for ${classes.length} types and ${properties.length} properties, generated from <code>chronicle.ttl</code>.</p>
    <p class="muted">Vocabulary version ${escape(version)}. Use your browser’s Find command to search this page.</p>
    <p>Types inherit their parents’ properties. Cardinality gives the minimum and maximum number of values: <code>0…1</code> is optional and single-valued; <code>0…unbounded</code> permits multiple values.</p></header>
    <h2 id="types">Types</h2>${classSections}<h2 id="properties">Properties</h2>${propertySections}
    <footer>Chronicle schema · ${escape(version)} · MIT</footer></main></body></html>`,
    { ...prettierConfig, parser: 'html' }
  );
}

async function main() {
  const ttlPath = process.argv[2] || fileURLToPath(new URL('../chronicle.ttl', import.meta.url));
  const output = process.argv[3] || fileURLToPath(new URL('../docs/schema.html', import.meta.url));
  const html = await renderDocumentation(readFileSync(ttlPath, 'utf8'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  console.log('Schema HTML generated successfully!');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
