import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionSchema, BaseAndChildrenSchema, EntitySchema } from '../dist/index.js';

// The schema site test checks that every documented example is valid; this
// covers the records the schema must reject.
const entity = {
  '@type': 'Entity',
  '@key': ['sourceId'],
  sourceId: 'fixture-entity-1',
  name: 'An example entity',
  url: 'https://example.com/record/1',
};
const action = { '@type': 'Action', '@key': ['sourceId'], sourceId: 'fixture-action-1' };

test('accepts each form of identity and nested objects', () => {
  assert.deepEqual(BaseAndChildrenSchema.parse({ ...action, object: entity }), {
    ...action,
    object: entity,
  });
  for (const identity of [
    { '@id': 'fixture-existing-id' },
    { '@key': [{ key: 'sourceId', value: 'fixture-2' }] },
  ]) {
    assert.ok(EntitySchema.safeParse({ '@type': 'Entity', ...identity }).success);
  }
});

test('rejects missing identity, invalid values, and types outside the vocabulary', () => {
  for (const [schema, record] of [
    [EntitySchema, { '@type': 'Entity', name: 'Missing identity' }],
    [EntitySchema, { '@type': 'Entity', '@key': [], '@id': '' }],
    [ActionSchema, { ...action, object: { '@type': 'Entity', name: 'No identity' } }],
    [EntitySchema, { ...entity, url: 'not a URL' }],
    [EntitySchema, { ...entity, name: 42 }],
    [EntitySchema, { ...entity, name: ['one', 'two'] }],
    [EntitySchema, { ...entity, sourceId: 1 }],
    [ActionSchema, { ...action, object: [entity] }],
    [BaseAndChildrenSchema, { ...entity, '@type': 'Book' }],
    [ActionSchema, { ...action, object: { '@type': 'Action', '@id': 'fixture-5' } }],
  ]) {
    assert.equal(schema.safeParse(record).success, false, JSON.stringify(record));
  }
});
