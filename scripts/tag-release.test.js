import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vocabularyVersion } from './tag-release.js';

test('reads the vocabulary version from the ontology', () => {
  assert.equal(
    vocabularyVersion(':ontology a owl:Ontology ;\n  owl:versionInfo "1.4.0" .'),
    '1.4.0'
  );
  assert.throws(() => vocabularyVersion(':ontology a owl:Ontology .'));
});
