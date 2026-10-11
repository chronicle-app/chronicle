// Writes alignments/<vocabulary>.terms.json: the classes and properties of the
// release that an alignment is checked against. The schema site fails its build
// when an alignment names a term that is not in the list.
//
//   node scripts/snapshot-vocabulary.js schemaorg 30.1
//   node scripts/snapshot-vocabulary.js activitystreams
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prettierConfig from '@chronicle.app/prettier-config';
import { Parser, Store } from 'n3';
import prettier from 'prettier';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const sorted = names => [...new Set(names)].sort();
const types = node => [node['@type']].flat();

const VOCABULARIES = {
  schemaorg: {
    namespace: 'https://schema.org/',
    source: release =>
      `https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/releases/${release}/schemaorg-current-https.jsonld`,
    license: 'CC BY-SA 3.0, https://schema.org/docs/terms.html',
    // Current terms, without the ones a later term supersedes. Pending terms
    // are listed, and also named under `pending`.
    read(text) {
      const terms = JSON.parse(text)['@graph'].filter(
        node => node['@id'].startsWith('schema:') && !node['schema:supersededBy']
      );
      const names = test =>
        terms.filter(node => test(node)).map(node => node['@id'].slice('schema:'.length));
      return {
        classes: names(node => types(node).includes('rdfs:Class')),
        properties: names(node => types(node).includes('rdf:Property')),
        pending: names(node => node['schema:isPartOf']?.['@id'] === 'https://pending.schema.org'),
      };
    },
  },
  activitystreams: {
    namespace: 'https://www.w3.org/ns/activitystreams#',
    // The namespace document is unversioned. It holds the terms of the W3C
    // Recommendation and the extensions published since.
    release: '2017-05-23',
    source: () => 'https://www.w3.org/ns/activitystreams-owl',
    license:
      'W3C Software and Document License, https://www.w3.org/copyright/software-license-2023/',
    // Current terms, without the deprecated ones.
    read(text) {
      const store = new Store(new Parser().parse(text));
      const typed = type => store.getSubjects(RDF + 'type', type, null).map(term => term.value);
      const deprecated = new Set(typed(OWL + 'DeprecatedProperty'));
      const names = uris =>
        uris
          .filter(uri => uri.startsWith(this.namespace) && !deprecated.has(uri))
          .map(uri => uri.slice(this.namespace.length));
      return {
        classes: names(typed(OWL + 'Class')),
        properties: names([
          ...typed(OWL + 'ObjectProperty'),
          ...typed(OWL + 'DatatypeProperty'),
          ...typed(RDF + 'Property'),
        ]),
        pending: [],
      };
    },
  },
};

const [name, requested] = process.argv.slice(2);
const vocabulary = VOCABULARIES[name];
const release = requested ?? vocabulary?.release;
if (!vocabulary || !release) {
  console.error('Usage: node scripts/snapshot-vocabulary.js schemaorg <release> | activitystreams');
  process.exit(1);
}

const source = vocabulary.source(release);
const response = await fetch(source);
if (!response.ok) throw new Error(`Could not read ${source}: HTTP ${response.status}`);
const { classes, properties, pending } = vocabulary.read(await response.text());
const snapshot = {
  vocabulary: vocabulary.namespace,
  release,
  source,
  license: vocabulary.license,
  classes: sorted(classes),
  properties: sorted(properties),
  pending: sorted(pending),
};
const output = fileURLToPath(new URL(`../alignments/${name}.terms.json`, import.meta.url));
await writeFile(
  output,
  await prettier.format(JSON.stringify(snapshot), { ...prettierConfig, parser: 'json' })
);
console.log(
  `Wrote ${classes.length} classes and ${properties.length} properties of ${name} ${release} to ${output}`
);
