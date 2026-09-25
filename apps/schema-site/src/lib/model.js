import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { schemaVersion } from '../../../../core/schema/scripts/schema-version.js';
import { serializeExample } from './example-payload.js';

export const NAMESPACE = 'https://schema.chronicle.app/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const DOC = 'https://schema.chronicle.app/docs/';

const localName = uri => (uri.startsWith(NAMESPACE) ? uri.slice(NAMESPACE.length) : uri);
const byName = (a, b) => a.name.localeCompare(b.name, 'en');

/** Reads chronicle.ttl and examples.ttl from a schema package directory. */
export async function readSchema(directory) {
  return loadSchema({
    ontology: await readFile(join(directory, 'chronicle.ttl'), 'utf8'),
    examples: await readFile(join(directory, 'examples.ttl'), 'utf8'),
  });
}

/**
 * Reads the vocabulary and its documentation examples into one graph. Each file
 * is parsed on its own, so prefixes and blank-node labels stay local to it.
 */
export async function loadSchema({ ontology, examples }) {
  const store = new Store();
  // Keep statements in authored order so examples render as they are written.
  const statements = new Map();
  for (const source of [ontology, examples]) {
    for (const statement of new Parser().parse(source)) {
      store.addQuad(statement);
      const subject = statement.subject.id;
      if (!statements.has(subject)) statements.set(subject, []);
      statements.get(subject).push(statement);
    }
  }

  const objects = (subject, predicate) => store.getObjects(subject, predicate, null);
  const first = (subject, predicate) => objects(subject, predicate)[0]?.value;
  const declared = type =>
    store
      .getSubjects(RDF + 'type', type, null)
      .filter(subject => subject.value.startsWith(NAMESPACE) && subject.value !== NAMESPACE);

  const exampleRecords = new Map();
  async function readExample(node) {
    if (!exampleRecords.has(node.value)) {
      // Records keep the order they are written in.
      const values = (statements.get(node.id) ?? [])
        .filter(statement => statement.predicate.value === RDF + 'value')
        .map(statement => statement.object);
      if (values.length === 0) throw new Error(`Example ${node.value} needs an rdf:value`);
      const id = node.value.split('/').at(-1);
      exampleRecords.set(node.value, {
        id,
        uri: node.value,
        title: first(node, RDFS + 'label') ?? id,
        section: first(node, DOC + 'section') ?? 'Examples',
        position: [...statements.keys()].indexOf(node.id),
        body: (first(node, RDFS + 'comment') ?? '').trim(),
        ...(await serializeExample(store, values, statements)),
      });
    }
    return exampleRecords.get(node.value);
  }
  const examplesOf = subject =>
    Promise.all(objects(subject, SKOS + 'example').map(node => readExample(node)));

  const classes = new Map();
  for (const subject of declared(RDFS + 'Class')) {
    classes.set(localName(subject.value), {
      kind: 'class',
      uri: subject.value,
      name: localName(subject.value),
      comment: first(subject, RDFS + 'comment') ?? '',
      parents: objects(subject, RDFS + 'subClassOf').map(parent => localName(parent.value)),
      properties: [],
      examples: await examplesOf(subject),
    });
  }

  const properties = new Map();
  for (const subject of declared(RDF + 'Property')) {
    const name = localName(subject.value);
    const cardinality = predicate => {
      const value = first(subject, OWL + predicate);
      return value === undefined ? null : Number(value);
    };
    const property = {
      kind: 'property',
      uri: subject.value,
      name,
      comment: first(subject, RDFS + 'comment') ?? '',
      domain: objects(subject, NAMESPACE + 'domainIncludes').map(term => localName(term.value)),
      range: objects(subject, NAMESPACE + 'rangeIncludes').map(term => localName(term.value)),
      min: cardinality('minCardinality') ?? 0,
      max: cardinality('maxCardinality'),
      examples: await examplesOf(subject),
    };
    for (const term of [...property.domain, ...property.range]) {
      if (!classes.has(term)) throw new Error(`Property ${name} refers to undeclared ${term}`);
    }
    for (const term of property.domain) classes.get(term).properties.push(name);
    properties.set(name, property);
  }

  // Validate the whole hierarchy, including cycles that have no root.
  function ancestors(name, path = []) {
    if (path.includes(name)) throw new Error(`Cyclic class inheritance: ${name}`);
    return classes.get(name).parents.flatMap(parent => {
      if (!classes.has(parent)) throw new Error(`Undeclared parent class: ${parent}`);
      return [parent, ...ancestors(parent, [...path, name])];
    });
  }
  for (const record of classes.values()) {
    record.ancestors = [...new Set(ancestors(record.name))];
    record.properties.sort();
  }
  for (const record of classes.values()) {
    record.children = [...classes.values()]
      .filter(other => other.parents.includes(record.name))
      .map(other => other.name)
      .sort();
  }

  const overview = await examplesOf(NAMESPACE);
  // Examples and their sections keep the order they are written in.
  const examplesList = [...exampleRecords.values()].sort((a, b) => a.position - b.position);
  for (const example of examplesList) {
    example.usedBy = store
      .getSubjects(SKOS + 'example', example.uri, null)
      .map(subject => localName(subject.value))
      .filter(name => classes.has(name) || properties.has(name))
      .sort();
  }

  return {
    version: schemaVersion(ontology),
    classes: new Map([...classes.values()].sort(byName).map(record => [record.name, record])),
    properties: new Map([...properties.values()].sort(byName).map(record => [record.name, record])),
    overview,
    examples: examplesList,
  };
}
