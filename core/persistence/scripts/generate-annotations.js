// Generate src/annotations/generated.ts from chronicle.ttl: the per-predicate
// annotations, value types and derived effects the fold reads.
//   node scripts/generate-annotations.js [chronicle.ttl] [output]
//
// chronicle.ttl is written in OWL and SHACL. The derivations below read the
// vocabulary `normalize` adds beside it: rdfs:Class, rdf:Property,
// :rangeIncludes and owl:maxCardinality.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DataFactory, Parser, Store } from 'n3';
import prettier from 'prettier';
import prettierConfig from '@chronicle.app/prettier-config';
import { readDerivedEffects } from './derived-effects.js';

const { namedNode, literal, quad } = DataFactory;
const NS = 'https://schema.chronicle.app/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SH = 'http://www.w3.org/ns/shacl#';

const [
  ttlPath = createRequire(import.meta.url).resolve('@chronicle.app/schema/chronicle.ttl'),
  outputPath = fileURLToPath(new URL('../src/annotations/generated.ts', import.meta.url)),
] = process.argv.slice(2);

/** The members of an `owl:unionOf` list, or the term itself. */
const members = (store, term) => {
  if (term.termType !== 'BlankNode') return [term];
  const list = store.getQuads(term, namedNode(OWL + 'unionOf'), null, null)[0]?.object;
  const out = [];
  for (let node = list; node && node.value !== RDF + 'nil';) {
    const first = store.getQuads(node, namedNode(RDF + 'first'), null, null)[0]?.object;
    if (first) out.push(first);
    node = store.getQuads(node, namedNode(RDF + 'rest'), null, null)[0]?.object;
  }
  return out;
};

/** Add the vocabulary the derivations read beside the OWL and SHACL chronicle.ttl uses. */
const normalize = store => {
  const added = [];
  for (const q of store.getQuads(null, namedNode(RDF + 'type'), namedNode(OWL + 'Class'), null))
    added.push(quad(q.subject, namedNode(RDF + 'type'), namedNode(RDFS + 'Class')));
  for (const kind of ['ObjectProperty', 'DatatypeProperty'])
    for (const q of store.getQuads(null, namedNode(RDF + 'type'), namedNode(OWL + kind), null))
      added.push(quad(q.subject, namedNode(RDF + 'type'), namedNode(RDF + 'Property')));
  for (const [from, to] of [
    ['range', 'rangeIncludes'],
    ['domain', 'domainIncludes'],
  ])
    for (const q of store.getQuads(null, namedNode(RDFS + from), null, null))
      for (const member of members(store, q.object))
        if (member.termType === 'NamedNode')
          added.push(quad(q.subject, namedNode(NS + to), member));
  for (const q of store.getQuads(null, namedNode(SH + 'maxCount'), null, null)) {
    const path = store.getQuads(q.subject, namedNode(SH + 'path'), null, null)[0]?.object;
    if (path) added.push(quad(path, namedNode(OWL + 'maxCardinality'), literal(q.object.value)));
  }
  store.addQuads(added);
};

const store = new Store(new Parser().parse(fs.readFileSync(ttlPath, 'utf8')));
normalize(store);

const objects = (subject, predicate) =>
  store.getQuads(namedNode(subject), namedNode(predicate), null, null).map(q => q.object.value);

const getRange = propertyId => objects(propertyId, NS + 'rangeIncludes');

const isMany = propertyId => {
  const maxCardinality = objects(propertyId, OWL + 'maxCardinality');
  if (maxCardinality.length === 0) {
    return true;
  }
  return maxCardinality[0] !== '1';
};

// :metric "gauge" | "sum" — aggregated time-series quantity the fold routes to
// the metrics table. Any form counts; the fold doesn't distinguish them.
const isMetric = propertyId => objects(propertyId, NS + 'metric').some(form => form !== 'false');

// :identityEffect "merge" | "cut" — identity-edge semantics for the fold engine.
const getIdentityEffect = propertyId =>
  objects(propertyId, NS + 'identityEffect')[0]
    ?.split('/')
    .pop();

// :abstract true — a super-property that only anchors the rdfs:subPropertyOf
// hierarchy. It carries a range for subsumption but is never instantiated, so it
// is excluded from PREDICATE_ANNOTATIONS.
const isAbstract = propertyId => objects(propertyId, NS + 'abstract')[0] === 'true';

// :observed true — an identity edge that is ALSO an ordinary observation. Without
// it a merge/cut predicate is pure machinery and never reaches a property row;
// with it the edge both merges and records a value that can change over time.
const isObserved = propertyId => objects(propertyId, NS + 'observed')[0] === 'true';

const subjectsOfType = type => [
  ...new Set(
    store
      .getQuads(null, namedNode(RDF + 'type'), namedNode(type), null)
      .map(q => q.subject.value)
      .filter(v => v.startsWith(NS))
  ),
];

// Ranges whose values are literals. The datatypes chronicle.ttl declares count
// too, so a range such as :JSONObject is a literal.
const LITERAL_RANGES = new Set([
  'Text',
  'Number',
  'Integer',
  'Float',
  'Boolean',
  'DateTime',
  'Date',
  'Time',
  'URL',
  'Selector',
  ...subjectsOfType(RDFS + 'Datatype').map(id => id.slice(NS.length)),
]);

const annotations = subjectsOfType(RDF + 'Property')
  .filter(id => !isAbstract(id) && getRange(id).length > 0)
  .map(id => {
    const range = getRange(id)[0]?.split('/').pop() || 'Text';
    const identityEffect = getIdentityEffect(id);
    return {
      predicate: id.slice(NS.length),
      cardinality: isMany(id) ? 'many' : 'one',
      range,
      isEntityRange: !LITERAL_RANGES.has(range),
      metric: isMetric(id),
      ...(identityEffect ? { identityEffect } : {}),
      ...(isObserved(id) ? { observed: true } : {}),
    };
  })
  .sort((a, b) => a.predicate.localeCompare(b.predicate));

const parents = Object.fromEntries(
  subjectsOfType(RDFS + 'Class')
    .map(id => [
      id.slice(NS.length),
      objects(id, RDFS + 'subClassOf')
        .filter(p => p.startsWith(NS))
        .map(p => p.slice(NS.length))
        .sort(),
    ])
    .sort(([a], [b]) => a.localeCompare(b))
);

const descendsFrom = (type, ancestor, seen = new Set()) => {
  if (type === ancestor) return true;
  if (seen.has(type)) return false;
  seen.add(type);
  return (parents[type] ?? []).some(p => descendsFrom(p, ancestor, seen));
};

// Value-object types: descendants of StructuredValue. A node of one of these
// types is a content-identified value (no @key), not an entity.
const valueTypes = Object.keys(parents)
  .filter(type => descendsFrom(type, 'StructuredValue'))
  .sort();

const source = `// AUTO-GENERATED from chronicle.ttl by scripts/generate-annotations.js. Do not edit.
import type { DerivedEffects, PredicateAnnotation } from './schema.js';

export const PREDICATE_ANNOTATIONS: Record<string, PredicateAnnotation> = ${JSON.stringify(
  Object.fromEntries(annotations.map(a => [a.predicate, a]))
)};

export const VALUE_TYPES: ReadonlySet<string> = new Set(${JSON.stringify(valueTypes)});

export const DERIVED_EFFECTS: DerivedEffects = ${JSON.stringify(readDerivedEffects(store))};
`;

fs.writeFileSync(
  outputPath,
  await prettier.format(source, { ...prettierConfig, parser: 'typescript' })
);
