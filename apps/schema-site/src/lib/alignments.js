// How Chronicle's terms relate to other vocabularies. chronicle.ttl points its
// terms to schema.org's, and core/schema/alignments/<id>.ttl holds the notes for
// one vocabulary and any mappings to it that are not part of the vocabulary.
// Mappings are SKOS: hints for mapping data, which a reasoner draws nothing
// from. Every mapping is checked against <id>.terms.json, the terms of the
// release that the alignment names.
import { Parser, Store } from 'n3';
import { TERM } from './html.js';

const CHRONICLE = 'https://schema.chronicle.app/';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const DOC = 'https://schema.chronicle.app/docs/';

// What each mapping says about the Chronicle term, in the order pages list them.
const RELATIONS = {
  [SKOS + 'exactMatch']: 'same',
  [SKOS + 'broadMatch']: 'narrower',
  [SKOS + 'narrowMatch']: 'broader',
  [SKOS + 'closeMatch']: 'close',
  [SKOS + 'relatedMatch']: 'related',
  [DOC + 'unlike']: 'unlike',
};
const ORDER = ['same', 'narrower', 'broader', 'close', 'related', 'unlike'];
// Statements a reasoner acts on. Chronicle stands on its own, so none of them
// may point to another vocabulary.
const ENTAILING = [
  RDFS + 'subClassOf',
  RDFS + 'subPropertyOf',
  OWL + 'equivalentClass',
  OWL + 'equivalentProperty',
];

// Another vocabulary's term in prose, such as `as:origin`: the prefix, then the name.
const PREFIXED = /(?<![\w/:])([a-z][a-z0-9]*):([A-Za-z][A-Za-z0-9]*)/g;
/** A term in prose: Chronicle's `:Term`, or another vocabulary's `prefix:Name`. */
export const REFERENCE = new RegExp(`${TERM.source}|${PREFIXED.source}`, 'g');
const outsideCode = text => text.replaceAll(/`[^`]*`/g, '');
const mappings = store =>
  Object.keys(RELATIONS).flatMap(predicate => store.getQuads(null, predicate, null));

// The term's alignment with the vocabulary, added if it has none yet.
function alignmentOf(term, vocabulary) {
  let found = term.alignments.find(candidate => candidate.vocabulary === vocabulary.id);
  if (!found) {
    found = { vocabulary: vocabulary.id, relations: [], note: '' };
    term.alignments.push(found);
  }
  return found;
}

/** Throws on a statement in `store` that a reasoner would act on across vocabularies. */
function rejectEntailing(file, store) {
  for (const predicate of ENTAILING) {
    for (const { subject, object } of store.getQuads(null, predicate, null)) {
      // A subclass in the Chronicle namespace is part of the hierarchy, and the
      // XSD type a datatype is equivalent to defines it.
      const { termType, value } = object;
      if (termType !== 'NamedNode' || value.startsWith(CHRONICLE) || value.startsWith(XSD))
        continue;
      throw new Error(
        `${file}: ${subject.value} ${predicate} ${value}. Point to another vocabulary's term with skos:exactMatch, skos:closeMatch, or skos:broadMatch instead.`
      );
    }
  }
}

/** The term `prefix:name` of one of `vocabularies`, or null when it has none. */
export function findTerm(vocabularies, prefix, name) {
  const vocabulary = vocabularies.find(candidate => candidate.prefix === prefix);
  if (!vocabulary?.classes.has(name) && !vocabulary?.properties.has(name)) return null;
  return { vocabulary: vocabulary.id, name, uri: vocabulary.namespace + name };
}

/**
 * Reads each alignment, `{ id, turtle, terms }`, and gives every class and
 * property its `alignments`: one entry per vocabulary it relates to, with the
 * relations and the note. `ontology` holds chronicle.ttl's statements. Throws
 * when a mapping or note names a term that is not declared, or that the
 * release does not have, when a term shares a name with another vocabulary's
 * term that it neither maps to nor marks as unlike, and when a subclass or an
 * equivalence points to another vocabulary.
 */
export function alignTerms({ ontology, alignments, classes, properties }) {
  const vocabularies = alignments.map(file => readVocabulary(file));
  const termOf = (uri, file) => {
    const name = uri.startsWith(CHRONICLE) ? uri.slice(CHRONICLE.length) : null;
    const term = classes.get(name) ?? properties.get(name);
    if (!term) throw new Error(`${file}: ${uri} is not a Chronicle class or property`);
    return term;
  };
  for (const term of [...classes.values(), ...properties.values()]) term.alignments = [];

  function relate(file, { subject, predicate, object }, vocabulary) {
    const term = termOf(subject.value, file);
    const name = object.value.slice(vocabulary.namespace.length);
    const names = term.kind === 'class' ? vocabulary.classes : vocabulary.properties;
    if (!names.has(name))
      throw new Error(
        `${file}: :${term.name} names ${vocabulary.prefix}:${name}, which is not a ${term.kind} in ${vocabulary.name} ${vocabulary.release}`
      );
    alignmentOf(term, vocabulary).relations.push({
      relation: RELATIONS[predicate.value],
      name,
      uri: object.value,
      pending: vocabulary.pending.has(name),
    });
  }

  rejectEntailing('chronicle.ttl', ontology);
  for (const vocabulary of vocabularies) rejectEntailing(vocabulary.file, vocabulary.store);
  for (const quad of mappings(ontology)) {
    const vocabulary = vocabularies.find(candidate =>
      quad.object.value.startsWith(candidate.namespace)
    );
    if (!vocabulary)
      throw new Error(
        `chronicle.ttl maps ${quad.subject.value} to ${quad.object.value}, but no alignment describes that vocabulary`
      );
    relate('chronicle.ttl', quad, vocabulary);
  }
  for (const vocabulary of vocabularies) {
    for (const quad of mappings(vocabulary.store)) {
      if (!quad.object.value.startsWith(vocabulary.namespace))
        throw new Error(
          `${vocabulary.file}: ${quad.object.value} is not in ${vocabulary.namespace}`
        );
      relate(vocabulary.file, quad, vocabulary);
    }
  }

  // A prefixed name in a note links to that vocabulary's term, so it must exist.
  const prefixes = new Set(vocabularies.map(vocabulary => vocabulary.prefix));
  for (const vocabulary of vocabularies) {
    for (const { subject, object } of vocabulary.store.getQuads(null, DOC + 'note', null)) {
      const term = termOf(subject.value, vocabulary.file);
      const alignment = term.alignments.find(candidate => candidate.vocabulary === vocabulary.id);
      if (!alignment)
        throw new Error(`${vocabulary.file}: the note on :${term.name} needs a mapping`);
      if (alignment.note)
        throw new Error(`${vocabulary.file}: :${term.name} has more than one note`);
      const text = outsideCode(object.value);
      for (const [reference] of text.matchAll(TERM)) {
        const name = reference.slice(1);
        if (!classes.has(name) && !properties.has(name))
          throw new Error(
            `${vocabulary.file}: the note on :${term.name} names undeclared ${reference}`
          );
      }
      for (const [reference, prefix, name] of text.matchAll(PREFIXED)) {
        if (prefixes.has(prefix) && !findTerm(vocabularies, prefix, name))
          throw new Error(
            `${vocabulary.file}: the note on :${term.name} names unknown ${reference}`
          );
      }
      alignment.note = object.value;
    }
  }

  // A shared name is a mapping or a false friend; either way, it is reviewed.
  for (const vocabulary of vocabularies) {
    for (const term of [...classes.values(), ...properties.values()]) {
      const names = term.kind === 'class' ? vocabulary.classes : vocabulary.properties;
      const shortened = vocabulary.endings
        .filter(ending => term.name.endsWith(ending) && term.name !== ending)
        .map(ending => term.name.slice(0, -ending.length));
      const related = term.alignments.find(alignment => alignment.vocabulary === vocabulary.id);
      for (const name of new Set([term.name, ...shortened])) {
        if (names.has(name) && !related?.relations.some(relation => relation.name === name))
          throw new Error(
            `:${term.name} shares its name with ${vocabulary.prefix}:${name}. Map it to that term, or mark it doc:unlike in ${vocabulary.file}.`
          );
      }
    }
  }

  for (const term of [...classes.values(), ...properties.values()]) {
    for (const alignment of term.alignments) {
      alignment.relations.sort(
        (a, b) =>
          ORDER.indexOf(a.relation) - ORDER.indexOf(b.relation) || a.name.localeCompare(b.name)
      );
    }
  }
  return vocabularies.map(({ store: _store, endings: _endings, ...vocabulary }) => vocabulary);
}

/** The vocabulary an alignment describes, and the terms of its release. */
function readVocabulary({ id, turtle, terms }) {
  const file = `alignments/${id}.ttl`;
  const store = new Store(new Parser().parse(turtle));
  const [node, ...others] = store.getSubjects(DOC + 'release', null, null);
  if (!node || others.length > 0)
    throw new Error(`${file} must describe one vocabulary, with its doc:release`);
  const first = predicate => store.getObjects(node, predicate, null)[0]?.value;
  const vocabulary = {
    id,
    file,
    namespace: node.value,
    name: first(RDFS + 'label') ?? id,
    prefix: first(DOC + 'prefix'),
    release: first(DOC + 'release'),
    url: first(RDFS + 'seeAlso') ?? node.value,
    classes: new Set(terms.classes),
    properties: new Set(terms.properties),
    pending: new Set(terms.pending),
    endings: store.getObjects(node, DOC + 'nameEnding', null).map(ending => ending.value),
    store,
  };
  if (!vocabulary.prefix) throw new Error(`${file} must give the vocabulary's doc:prefix`);
  if (terms.vocabulary !== vocabulary.namespace || terms.release !== vocabulary.release)
    throw new Error(
      `alignments/${id}.terms.json lists ${terms.vocabulary} ${terms.release}, but ${file} names ${vocabulary.namespace} ${vocabulary.release}`
    );
  return vocabulary;
}
