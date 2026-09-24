import assert from 'node:assert/strict';
import { test } from 'node:test';
import { versionProblem } from './check-version.js';

const ontology = (version, extra = '') => `@prefix owl: <http://www.w3.org/2002/07/owl#> .
<https://schema.chronicle.app/> a owl:Ontology; owl:versionInfo "${version}" .
${extra}`;

test('an unchanged vocabulary needs no new version', () => {
  assert.equal(versionProblem(ontology('0.1.0'), ontology('0.1.0')), null);
  assert.equal(versionProblem(ontology('0.1.0'), null), null);
});

test('a changed vocabulary needs a higher version', () => {
  const changed =
    '<https://schema.chronicle.app/Task> a <http://www.w3.org/2000/01/rdf-schema#Class> .';
  assert.equal(versionProblem(ontology('0.1.1', changed), ontology('0.1.0')), null);
  assert.equal(versionProblem(ontology('0.10.0', changed), ontology('0.9.0')), null);
  assert.match(
    versionProblem(ontology('0.1.0', changed), ontology('0.1.0')),
    /raise owl:versionInfo above 0\.1\.0/
  );
  assert.match(versionProblem(ontology('0.0.9', changed), ontology('0.1.0')), /it is 0\.0\.9/);
});
