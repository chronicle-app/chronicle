import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const generator = fileURLToPath(new URL('generate-schemas.js', import.meta.url));
const ontology = readFileSync(new URL('../schema.ttl', import.meta.url), 'utf8');

function generate(ttl) {
  const directory = mkdtempSync(join(tmpdir(), 'chronicle-schema-test-'));
  try {
    const input = join(directory, 'schema.ttl');
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

test('generation fails for undeclared property ranges and malformed Turtle', () => {
  const missing = generate(ontology.replace(':rangeIncludes :URL', ':rangeIncludes :Missing'));
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Undeclared class/);
  assert.notEqual(generate('this is not Turtle').status, 0);
});
