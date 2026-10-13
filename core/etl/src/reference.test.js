import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reference } from '../dist/index.js';

const key = ['@type', 'source', 'sourceId'];
const person = {
  '@type': 'Person',
  '@key': key,
  source: 'icloud',
  sourceId: '1',
  handle: 'you@example.com',
  sameAs: ['@me'],
};

test("a reference keeps a node's identity and nothing else", () => {
  assert.deepEqual(reference(person), {
    '@type': 'Person',
    '@key': key,
    source: 'icloud',
    sourceId: '1',
  });

  // A dotted key field keeps the nested node, itself as a reference. A
  // computed entry and an action field are in the key already.
  const posting = {
    '@type': 'Posting',
    '@key': [...key, 'account.sourceId', { key: 'kind', value: 'cash' }, 'action.timestamp'],
    source: 'wallet',
    sourceId: 't1',
    amount: 5,
    account: person,
  };
  assert.deepEqual(reference(posting), {
    '@type': 'Posting',
    '@key': posting['@key'],
    source: 'wallet',
    sourceId: 't1',
    account: reference(person),
  });

  // A splat keeps each member as a reference, and an @id stands alone.
  const channel = {
    '@type': 'Channel',
    '@key': ['@type', 'source', 'member[*].handle'],
    source: 'chat',
    member: [person],
    name: 'Everyone',
  };
  assert.deepEqual(reference(channel), {
    '@type': 'Channel',
    '@key': channel['@key'],
    source: 'chat',
    member: [reference(person)],
  });
  assert.deepEqual(reference({ '@type': 'Entity', '@id': 'abc', name: 'n' }), {
    '@type': 'Entity',
    '@id': 'abc',
  });
});
