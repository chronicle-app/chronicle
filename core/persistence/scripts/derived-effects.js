// Shared by runtime generation and the public reference. Only the TTL owns
// the action/property lists; this module defines how declarations are resolved.
const NS = 'https://schema.chronicle.app/';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';

export function readDerivedEffects(store) {
  const values = (name, predicate) =>
    store.getQuads(NS + name, predicate, null).map(q => q.object.value);
  const names = (name, predicate) =>
    values(name, NS + predicate).map(v => {
      if (!v.startsWith(NS))
        throw new Error(`${name}: ${predicate} must reference the Chronicle vocabulary`);
      return v.slice(NS.length);
    });
  const subjects = (predicate, object) =>
    store
      .getQuads(null, predicate, object)
      .map(q => q.subject.value.slice(NS.length))
      .sort();
  const classes = new Set(subjects(RDF + 'type', RDFS + 'Class'));
  const properties = new Set(subjects(RDF + 'type', RDF + 'Property'));
  const derived = subjects(RDF + 'type', NS + 'DerivedProperty');
  const ancestors = (name, seen = new Set()) => {
    if (seen.has(name)) throw new Error(`Cyclic action inheritance at ${name}`);
    return [
      name,
      ...values(name, RDFS + 'subClassOf').flatMap(parent =>
        ancestors(parent.slice(NS.length), new Set([...seen, name]))
      ),
    ];
  };
  const actions = [...classes].filter(name => ancestors(name).includes('Action')).sort();
  const actionSet = new Set(actions);
  for (const annotation of ['assertedBy', 'assertedByExact', 'retractedBy', 'runPredicate']) {
    for (const name of subjects(NS + annotation, null)) {
      if (!properties.has(name) && !derived.includes(name))
        throw new Error(`${name}: ${annotation} requires a declared property`);
    }
  }
  for (const annotation of ['encounterKind', 'encounterLevel']) {
    for (const name of subjects(NS + annotation, null)) {
      if (annotation === 'encounterLevel' && derived.includes(name)) continue;
      if (!actionSet.has(name)) throw new Error(`${name}: ${annotation} requires an action`);
      // Policies are declared together; partial overrides would be ambiguous.
      if (
        values(name, NS + 'encounterKind').length === 0 ||
        values(name, NS + 'encounterLevel').length === 0
      )
        throw new Error(`${name}: encounterKind and encounterLevel must be declared together`);
    }
  }
  const expand = types => actions.filter(name => ancestors(name).some(a => types.includes(a)));
  const one = (name, predicate, allowed) => {
    const found = names(name, predicate);
    if (found.length !== 1 || !allowed.includes(found[0]))
      throw new Error(`${name}: ${predicate} must be one of ${allowed.join(', ')}`);
    return found[0];
  };
  const runs = [];
  for (const predicate of [...properties, ...derived].sort()) {
    const assertedBy = names(predicate, 'assertedBy').sort();
    const assertedByExact = names(predicate, 'assertedByExact').sort();
    const retractedBy = names(predicate, 'retractedBy').sort();
    if ([...assertedBy, ...assertedByExact, ...retractedBy].length === 0) continue;
    for (const type of [...assertedBy, ...assertedByExact, ...retractedBy]) {
      if (!actionSet.has(type)) throw new Error(`${predicate}: unknown action ${type}`);
    }
    const targets = names(predicate, 'runPredicate');
    if (targets.length > 1 || (targets.length > 0 && !derived.includes(targets[0])))
      throw new Error(`${predicate}: runPredicate must name a derived query property`);
    runs.push({
      predicate: targets[0] || predicate,
      declaredOn: predicate,
      assertedBy,
      assertedByExact,
      retractedBy,
      openers: [...new Set([...expand(assertedBy), ...assertedByExact])].sort(),
      closers: expand(retractedBy),
    });
  }
  const encounters = {};
  for (const action of actions) {
    const owner = ancestors(action).find(name => values(name, NS + 'encounterKind').length);
    if (!owner) continue;
    const kind = one(owner, 'encounterKind', ['object', 'message']);
    const level = one(owner, 'encounterLevel', ['encounter', 'interaction']);
    if ((kind === 'object') !== (level === 'encounter'))
      throw new Error(`${owner}: unsupported encounter kind/level combination`);
    encounters[action] = { kind, level, declaredOn: owner };
  }
  const encounterPredicates = {};
  for (const predicate of derived) {
    if (values(predicate, NS + 'encounterLevel').length === 0) continue;
    const level = one(predicate, 'encounterLevel', ['encounter', 'interaction']);
    const booleans = values(predicate, NS + 'bidirectional');
    if (booleans.length !== 1 || !['true', 'false'].includes(booleans[0]))
      throw new Error(`${predicate}: bidirectional must be true or false`);
    encounterPredicates[predicate] = { level, bidirectional: booleans[0] === 'true' };
  }
  const propagatingRelations = subjects(NS + 'propagatesEncounter', null).filter(name => {
    if (!properties.has(name)) throw new Error(`${name}: propagation requires a property`);
    const flags = values(name, NS + 'propagatesEncounter');
    if (flags.length !== 1 || !['true', 'false'].includes(flags[0]))
      throw new Error(`${name}: propagatesEncounter must be true or false`);
    return flags[0] === 'true';
  });
  return { runs, encounters, encounterPredicates, propagatingRelations };
}
