// Reads the terms chronicle.ttl declares: OWL classes and datatypes, and
// properties with their rdfs:domain, rdfs:range, and the SHACL property shapes
// that limit how many values they take. The generator and the schema site both
// read the vocabulary through these.

export const NAMESPACE = 'https://schema.chronicle.app/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const SH = 'http://www.w3.org/ns/shacl#';

// A property that takes both entities and text, such as sameAs, is neither an
// object nor a datatype property, so it stays an rdf:Property.
const PROPERTY_TYPES = [OWL + 'ObjectProperty', OWL + 'DatatypeProperty', RDF + 'Property'];

const isTerm = term =>
  term.termType === 'NamedNode' && term.value.startsWith(NAMESPACE) && term.value !== NAMESPACE;

const declared = (store, type) =>
  store.getSubjects(RDF + 'type', type, null).filter(term => isTerm(term));

export const declaredClasses = store => declared(store, OWL + 'Class');
export const declaredDatatypes = store => declared(store, RDFS + 'Datatype');
export const declaredProperties = store => PROPERTY_TYPES.flatMap(type => declared(store, type));

/** A class's parents in the vocabulary. Parents in other vocabularies are left out. */
export const parentsOf = (store, id) =>
  store
    .getObjects(id, RDFS + 'subClassOf', null)
    .filter(term => term.termType === 'NamedNode' && term.value.startsWith(NAMESPACE))
    .map(term => term.value);

function listItems(store, head) {
  const items = [];
  for (let node = head; node.value !== RDF + 'nil';) {
    const [first] = store.getObjects(node, RDF + 'first', null);
    const [rest] = store.getObjects(node, RDF + 'rest', null);
    if (!first || !rest) throw new Error('Malformed RDF list');
    items.push(first);
    node = rest;
  }
  return items;
}

// A domain or range is one named term, or an owl:unionOf of named terms. OWL
// reads two rdfs:domain statements as both at once, never either one, so a
// property with several is rejected rather than read as a union.
function termsOf(store, id, predicate) {
  const expressions = store.getObjects(id, predicate, null);
  if (expressions.length > 1) {
    throw new Error(`${id} has more than one ${predicate}; list them in one owl:unionOf`);
  }
  return expressions.flatMap(expression => {
    if (expression.termType === 'NamedNode') return [expression.value];
    const [list] = store.getObjects(expression, OWL + 'unionOf', null);
    if (!list) throw new Error(`${id}: ${predicate} must be a named term or an owl:unionOf`);
    return listItems(store, list).map(item => {
      if (item.termType !== 'NamedNode') throw new Error(`${id}: a union lists named terms`);
      return item.value;
    });
  });
}

export const domainOf = (store, id) => termsOf(store, id, RDFS + 'domain');
export const rangeOf = (store, id) => termsOf(store, id, RDFS + 'range');

/**
 * How many values a property takes, from the SHACL shapes whose sh:path is the
 * property: `min` from sh:minCount (0 without one), `max` from sh:maxCount
 * (null without one, meaning a list).
 */
export function cardinalityOf(store, id) {
  let min = 0;
  let max = null;
  for (const shape of store.getSubjects(SH + 'path', id, null)) {
    for (const count of store.getObjects(shape, SH + 'minCount', null)) {
      min = Math.max(min, Number(count.value));
    }
    for (const count of store.getObjects(shape, SH + 'maxCount', null)) {
      max = max === null ? Number(count.value) : Math.min(max, Number(count.value));
    }
  }
  return { min, max };
}
