const CHRONICLE = 'https://schema.chronicle.app/';
const DOC = 'https://schema.chronicle.app/docs/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const OWL = 'http://www.w3.org/2002/07/owl#';

function literal(term) {
  if (term.language) return { '@value': term.value, '@language': term.language };
  if (term.datatype.value === XSD + 'string') return term.value;
  return { '@value': term.value, '@type': term.datatype.value };
}

/**
 * Renders one documentation example three ways: Chronicle JSON (what a plugin
 * emits), JSON-LD, and Turtle. An example has one or more records; each is a
 * root node plus every blank node reachable from it. Named nodes are
 * references and are not expanded. `statements` maps each subject to its
 * statements in authored order.
 */
export async function serializeExample(store, roots, statements) {
  for (const root of roots) {
    if (!['BlankNode', 'NamedNode'].includes(root.termType)) {
      throw new Error('An example value must be an RDF node');
    }
  }
  const nodes = new Map();
  const references = new Map(roots.map(root => [root.id, 1]));
  const labels = new Map();
  function collect(node) {
    if (nodes.has(node.id)) return;
    if (node.termType === 'BlankNode') labels.set(node.id, `n${labels.size}`);
    const triples = statements?.get(node.id) ?? store.getQuads(node, null, null, null);
    nodes.set(node.id, triples);
    for (const { object } of triples) {
      if (object.termType !== 'BlankNode') continue;
      references.set(object.id, (references.get(object.id) ?? 0) + 1);
      collect(object);
    }
  }
  for (const root of roots) {
    collect(root);
    if (nodes.get(root.id).length === 0) throw new Error(`Example ${root.value} has no statements`);
  }
  for (const [id, count] of references) {
    if (count > 1) throw new Error(`Example node ${id} is nested twice; examples must be trees`);
  }

  const compact = iri =>
    iri.startsWith(DOC)
      ? 'doc:' + iri.slice(DOC.length)
      : iri.startsWith(CHRONICLE)
        ? iri.slice(CHRONICLE.length)
        : iri;
  const identifier = node =>
    node.termType === 'BlankNode' ? `_:${labels.get(node.id)}` : node.value;

  // doc:key is an RDF list of key field paths, such as ("@type" "source" "sourceId").
  function keyFields(head) {
    const fields = [];
    const seen = new Set();
    while (head.value !== RDF + 'nil') {
      if (head.termType !== 'BlankNode' || seen.has(head.id) || references.get(head.id) > 1) {
        throw new Error('doc:key must be an unshared, acyclic RDF list');
      }
      seen.add(head.id);
      const triples = nodes.get(head.id) ?? [];
      const item = triples.filter(q => q.predicate.value === RDF + 'first');
      const rest = triples.filter(q => q.predicate.value === RDF + 'rest');
      if (
        triples.length !== 2 ||
        item.length !== 1 ||
        rest.length !== 1 ||
        item[0].object.datatype?.value !== XSD + 'string'
      ) {
        throw new Error('doc:key must list plain string field paths');
      }
      fields.push(item[0].object.value);
      head = rest[0].object;
    }
    if (fields.length === 0) throw new Error('doc:key cannot be empty');
    return fields;
  }

  const emitted = new Set();
  function render(node) {
    const id = identifier(node);
    if (emitted.has(node.id) || !nodes.has(node.id)) return { '@id': id };
    emitted.add(node.id);
    const result = {};
    if (node.termType === 'NamedNode' || references.get(node.id) > 1) result['@id'] = id;
    const groups = new Map();
    for (const { predicate, object } of nodes.get(node.id)) {
      if (!groups.has(predicate.value)) groups.set(predicate.value, []);
      groups.get(predicate.value).push(object);
    }
    const types = groups.get(RDF + 'type') ?? [];
    if (types.some(term => term.termType !== 'NamedNode')) {
      throw new Error('Example rdf:type values must be named classes');
    }
    if (types.length > 0) {
      const names = types.map(term => compact(term.value));
      result['@type'] = names.length === 1 ? names[0] : names;
    }
    groups.delete(RDF + 'type');
    for (const [predicate, terms] of groups) {
      if (predicate === DOC + 'key') {
        if (terms.length !== 1) throw new Error('An example node can have only one doc:key');
        result['doc:key'] = { '@list': keyFields(terms[0]) };
        continue;
      }
      const maxTerm = store.getObjects(predicate, OWL + 'maxCardinality', null)[0];
      const max = maxTerm ? Number(maxTerm.value) : null;
      if (max !== null && terms.length > max) {
        throw new Error(`Example property ${compact(predicate)} exceeds maxCardinality ${max}`);
      }
      const values = terms.map(term =>
        term.termType === 'Literal' ? literal(term) : render(term)
      );
      // Vocabulary properties without a maximum are lists, even with one value.
      const many = predicate.startsWith(CHRONICLE) ? max === null || max > 1 : values.length > 1;
      result[compact(predicate)] = many ? values : values[0];
    }
    return result;
  }

  const hasKeys = [...nodes.values()].some(triples =>
    triples.some(q => q.predicate.value === DOC + 'key')
  );
  const records = roots.map(root => render(root));
  const context = { '@vocab': CHRONICLE, ...(hasKeys ? { doc: DOC } : {}) };
  const jsonld =
    records.length === 1
      ? { '@context': context, ...records[0] }
      : { '@context': context, '@graph': records };
  const chronicle = records.map(record => toChronicle(record));
  const turtle = toTurtle(roots, { nodes, compact, keyFields, hasKeys });
  return {
    jsonld,
    turtle,
    chronicle: chronicle.length === 1 ? chronicle[0] : chronicle,
    records: chronicle,
  };
}

/**
 * Chronicle JSON is the shape plugins emit: `@key` in place of doc:key, and
 * plain scalars for text, numbers, booleans, and dates. Dates are written as
 * ISO strings here; in TypeScript they are Date objects.
 */
function toChronicle(value) {
  if (Array.isArray(value)) return value.map(item => toChronicle(item));
  if (!value || typeof value !== 'object') return value;
  if ('@value' in value) {
    const datatype = value['@type'];
    if ([XSD + 'integer', XSD + 'decimal', XSD + 'double'].includes(datatype)) {
      const number = Number(value['@value']);
      return Number.isFinite(number) ? number : value;
    }
    if (datatype === XSD + 'boolean') return value['@value'] === 'true';
    if (value['@language'] || (datatype && datatype !== XSD + 'dateTime')) return value;
    return value['@value'];
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '@context')
      .map(([key, item]) =>
        key === 'doc:key' ? ['@key', item['@list']] : [key, toChronicle(item)]
      )
  );
}

/**
 * Pretty Turtle that mirrors how examples are authored: nested blank nodes as
 * [ … ] blocks and key lists as ( … ), rather than generated node labels.
 */
function toTurtle(roots, { nodes, compact, keyFields, hasKeys }) {
  let typed = false;
  const term = node => {
    if (node.termType === 'Literal') {
      const text = JSON.stringify(node.value);
      if (node.language) return `${text}@${node.language}`;
      if (node.datatype.value === XSD + 'string') return text;
      typed ||= node.datatype.value.startsWith(XSD);
      return `${text}^^${node.datatype.value.startsWith(XSD) ? 'xsd:' + node.datatype.value.slice(XSD.length) : `<${node.datatype.value}>`}`;
    }
    const name = compact(node.value);
    return name !== node.value && /^(doc:)?[A-Za-z][\w-]*$/.test(name)
      ? name.startsWith('doc:')
        ? name
        : ':' + name
      : `<${node.value}>`;
  };
  function block(node, depth) {
    const pad = '  '.repeat(depth + 1);
    const groups = new Map();
    for (const { predicate, object } of nodes.get(node.id)) {
      if (!groups.has(predicate.value)) groups.set(predicate.value, []);
      groups.get(predicate.value).push(object);
    }
    const lines = [...groups].map(([predicate, objects]) => {
      if (predicate === RDF + 'type')
        return pad + 'a ' + objects.map(object => term(object)).join(', ');
      if (predicate === DOC + 'key') {
        return `${pad}doc:key (${keyFields(objects[0])
          .map(field => JSON.stringify(field))
          .join(' ')})`;
      }
      const values = objects.map(object =>
        object.termType === 'BlankNode' ? `[\n${block(object, depth + 1)}\n${pad}]` : term(object)
      );
      return `${pad}${term({ termType: 'NamedNode', value: predicate })} ${values.join(', ')}`;
    });
    return lines.join(';\n');
  }
  const body = roots
    .map(root =>
      root.termType === 'BlankNode'
        ? `[\n${block(root, 0)}\n] .`
        : `${term(root)}\n${block(root, 0)} .`
    )
    .join('\n\n');
  const prefixes = [
    `@prefix : <${CHRONICLE}> .`,
    ...(hasKeys ? [`@prefix doc: <${DOC}> .`] : []),
    ...(typed ? [`@prefix xsd: <${XSD}> .`] : []),
  ];
  return `${prefixes.join('\n')}\n\n${body}`;
}
