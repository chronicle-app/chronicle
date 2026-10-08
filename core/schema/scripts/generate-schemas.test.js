import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('generate-schemas.js', import.meta.url));
const ontology = readFileSync(new URL('../chronicle.ttl', import.meta.url), 'utf8');

function generate(ttl) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-schema-test-'));
  try {
    const input = join(directory, 'chronicle.ttl');
    const output = join(directory, 'schema.ts');
    writeFileSync(input, ttl);
    const result = spawnSync(process.execPath, [generator, input, output], { encoding: 'utf8' });
    if (result.error) throw result.error;
    return { ...result, generated: result.status === 0 ? readFileSync(output, 'utf8') : null };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('repeated generation is byte-identical to committed output', () => {
  const first = generate(ontology);
  const second = generate(ontology);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.generated, second.generated);
  assert.equal(first.generated, readFileSync(new URL('../src/schema.ts', import.meta.url), 'utf8'));
});

test('generation fails for cyclic or undeclared parents', () => {
  const cycle = generate(`${ontology}\n:Base rdfs:subClassOf :Action .`);
  assert.notEqual(cycle.status, 0);
  assert.match(cycle.stderr, /Cyclic class inheritance/);
  const missing = generate(`${ontology}\n:Entity rdfs:subClassOf :Missing .`);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Undeclared parent/);
});

test('generation fails for undeclared property ranges, split domains, and malformed Turtle', () => {
  const missing = generate(ontology.replace('rdfs:range :URL', 'rdfs:range :Missing'));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Undeclared class/);
  // OWL reads two domains as both at once, so they must be one union.
  const split = generate(`${ontology}\n:name rdfs:domain :Action .`);
  assert.notEqual(split.status, 0);
  assert.match(split.stderr, /more than one .*domain/);
  assert.notEqual(generate('this is not Turtle').status, 0);
});

test('a class with two parents is listed once in each union', () => {
  const result = generate(
    `${ontology}\n:LocalBusiness a owl:Class; rdfs:subClassOf :Venue, :Organization; rdfs:comment "A business at a place." .`
  );
  assert.equal(result.status, 0, result.stderr);
  const union = result.generated.match(/export const EntityAndChildrenSchema[\s\S]*?\]\)/)[0];
  assert.equal(union.match(/literal\('LocalBusiness'\)/g).length, 1);
});

test('vocabulary version is generated and invalid declarations are rejected', () => {
  // Whatever the vocabulary's current version, swap it for others.
  const current = /owl:versionInfo "[^"]*"/;
  assert.match(ontology, current);
  const changed = generate(ontology.replace(current, 'owl:versionInfo "9.8.7"'));
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.generated, /SCHEMA_VERSION = '9.8.7'/);
  for (const replacement of ['', 'owl:versionInfo "invalid"', 'owl:versionInfo "0.1.0", "0.2.0"']) {
    const result = generate(ontology.replace(current, replacement || 'rdfs:comment "no version"'));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one stable semantic version/);
  }
});
