import { Parser, Store } from 'n3';

export function schemaVersion(ttl) {
  const store = new Store(new Parser().parse(ttl));
  const versions = store.getObjects(
    'https://schema.chronicle.app/',
    'http://www.w3.org/2002/07/owl#versionInfo',
    null
  );
  if (
    versions.length !== 1 ||
    versions[0].termType !== 'Literal' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(versions[0].value)
  ) {
    throw new Error(
      'Ontology must declare exactly one stable semantic version with owl:versionInfo.'
    );
  }
  return versions[0].value;
}
