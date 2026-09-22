import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionSchema, BaseAndChildrenSchema, EntitySchema } from '../dist/index.js';

const entity = {
  '@type': 'Entity',
  '@key': ['sourceId'],
  sourceId: 'fixture-entity-1',
  name: 'An example entity',
  url: 'https://example.com/record/1',
};

test('validates source-keyed entities and nested action objects', () => {
  assert.deepEqual(EntitySchema.parse(entity), entity);
  const action = {
    '@type': 'Action',
    '@key': ['sourceId'],
    sourceId: 'fixture-action-1',
    object: entity,
  };
  assert.deepEqual(ActionSchema.parse(action), action);
  assert.deepEqual(BaseAndChildrenSchema.parse(action), action);
});

test('accepts an existing id or a computed key entry as identity', () => {
  assert.ok(EntitySchema.safeParse({ '@type': 'Entity', '@id': 'fixture-existing-id' }).success);
  assert.ok(
    EntitySchema.safeParse({
      '@type': 'Entity',
      '@key': [{ key: 'sourceId', value: 'fixture-2' }],
    }).success
  );
});

test('rejects missing and empty identity on direct and nested nodes', () => {
  assert.equal(
    EntitySchema.safeParse({ '@type': 'Entity', name: 'Missing identity' }).success,
    false
  );
  assert.equal(EntitySchema.safeParse({ '@type': 'Entity', '@key': [], '@id': '' }).success, false);
  const result = ActionSchema.safeParse({
    '@type': 'Action',
    '@key': ['sourceId'],
    sourceId: 'fixture-action-2',
    object: { '@type': 'Entity', name: 'No identity' },
  });
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some(
      issue => issue.path[0] === 'object' && issue.message.includes('identity')
    )
  );
});

test('rejects invalid URLs, property types, and single-value cardinality violations', () => {
  for (const fields of [
    { url: 'not a URL' },
    { name: 42 },
    { name: ['one', 'two'] },
    { sourceId: 1 },
  ]) {
    assert.equal(EntitySchema.safeParse({ ...entity, ...fields }).success, false);
  }
  assert.equal(
    ActionSchema.safeParse({ '@type': 'Action', '@id': 'fixture-3', object: [entity] }).success,
    false
  );
});

test('rejects types outside the minimal vocabulary', () => {
  assert.equal(BaseAndChildrenSchema.safeParse({ ...entity, '@type': 'Book' }).success, false);
  assert.equal(
    ActionSchema.safeParse({
      '@type': 'Action',
      '@id': 'fixture-4',
      object: { '@type': 'Action', '@id': 'fixture-5' },
    }).success,
    false
  );
});
