import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Parser, Store } from 'n3';
import { schemaVersion } from '../../../../core/schema/scripts/schema-version.js';
import {
  cardinalityOf,
  declaredClasses,
  declaredDatatypes,
  declaredProperties,
  domainOf,
  parentsOf,
  rangeOf,
} from '../../../../core/schema/scripts/terms.js';
import { alignTerms } from './alignments.js';
import { serializeExample } from './example-payload.js';

export const NAMESPACE = 'https://schema.chronicle.app/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const DOC = 'https://schema.chronicle.app/docs/';

const localName = uri => (uri.startsWith(NAMESPACE) ? uri.slice(NAMESPACE.length) : uri);
const byName = (a, b) => a.name.localeCompare(b.name, 'en');

/** Reads chronicle.ttl, examples.ttl, and the alignments from a schema package directory. */
export async function readSchema(directory) {
  return loadSchema({
    ontology: await readFile(join(directory, 'chronicle.ttl'), 'utf8'),
    examples: await readFile(join(directory, 'examples.ttl'), 'utf8'),
    alignments: await readAlignments(join(directory, 'alignments')),
  });
}

/** Each alignment's Turtle, with the terms of the release it is checked against. */
async function readAlignments(directory) {
  const files = (await readdir(directory)).filter(file => file.endsWith('.ttl')).sort();
  return Promise.all(
    files.map(async file => {
      const id = file.slice(0, -'.ttl'.length);
      return {
        id,
        turtle: await readFile(join(directory, file), 'utf8'),
        terms: JSON.parse(await readFile(join(directory, `${id}.terms.json`), 'utf8')),
      };
    })
  );
}

/**
 * Reads the vocabulary and its documentation examples into one graph. Each file
 * is parsed on its own, so prefixes and blank-node labels stay local to it.
 * `alignments` relate the terms to other vocabularies (see alignments.js).
 */
export async function loadSchema({ ontology, examples, alignments = [] }) {
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
  const datatypes = new Set(declaredDatatypes(store).map(subject => subject.value));
  for (const subject of [...declaredClasses(store), ...declaredDatatypes(store)]) {
    classes.set(localName(subject.value), {
      kind: 'class',
      uri: subject.value,
      name: localName(subject.value),
      datatype: datatypes.has(subject.value),
      comment: first(subject, RDFS + 'comment') ?? '',
      parents: parentsOf(store, subject).map(parent => localName(parent)),
      properties: [],
      examples: await examplesOf(subject),
    });
  }

  const properties = new Map();
  for (const subject of declaredProperties(store)) {
    const name = localName(subject.value);
    const property = {
      kind: 'property',
      uri: subject.value,
      name,
      comment: first(subject, RDFS + 'comment') ?? '',
      domain: domainOf(store, subject).map(term => localName(term)),
      range: rangeOf(store, subject).map(term => localName(term)),
      ...cardinalityOf(store, subject),
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

  const vocabularies = alignTerms({ ontology: store, alignments, classes, properties });

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
    vocabularies,
  };
}
