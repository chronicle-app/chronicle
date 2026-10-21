import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Sha256, generateKeysetCID, keysetOf, nodeKey, URL_SOURCE } from '../dist/index.js';

const bytes = text => new TextEncoder().encode(text);

// Every hash below is pinned: a store keys everything it holds by them, so one
// that changes re-keys every archive. Never regenerate them to make this pass.
test('the hash is the same bytes it has always been', () => {
  assert.equal(base32Sha256(bytes('abc')), 'xj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq');
  assert.equal(base32Sha256(bytes('')), '4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq');
  assert.equal(
    generateKeysetCID({ source: 'goodreads', sourceId: '12345' }),
    '3ui7iw46snxiprenycrnfjzgoxnpeqxnu44ys3w4zb63gmuvlojq'
  );
  assert.equal(
    generateKeysetCID({ url: 'https://example.com/book/1' }),
    'p3zegpyhg2pplvlnfnyfac7si3ier3pqcnfkgs7xk44q6qy2x4ca'
  );
  assert.equal(
    generateKeysetCID({ '@type': 'Person', source: 'chronicle', handle: 'myself' }),
    'emdi7rdijuj2vgwznpyc7hvyvdziqqtrf2funqbf2suyuzo2zsua'
  );
  // However its keys are ordered.
  assert.equal(
    generateKeysetCID({ handle: 'myself', source: 'chronicle', '@type': 'Person' }),
    'emdi7rdijuj2vgwznpyc7hvyvdziqqtrf2funqbf2suyuzo2zsua'
  );
  assert.throws(() => generateKeysetCID({}), /no identity/);
});

test("a node's identity is the hash of the keyset its key names", () => {
  const photo = {
    '@type': 'ImageObject',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'apple-notes',
    sourceId: 'IMAGE-1',
    contentPath: '/somewhere/on/this/mac.jpeg',
  };
  assert.deepEqual(keysetOf(photo, 'apple-notes'), {
    '@type': 'ImageObject',
    source: 'apple-notes',
    sourceId: 'IMAGE-1',
  });
  assert.equal(nodeKey(photo), generateKeysetCID(keysetOf(photo, 'apple-notes')));
  // Only the key counts: not where the file is, or whether it's there.
  assert.equal(nodeKey({ ...photo, contentPath: undefined }), nodeKey(photo));
  // `source` is the record's, for a node that names none.
  const { source, ...unsourced } = photo;
  assert.equal(nodeKey(unsourced, source), nodeKey(photo));

  // Paths follow nested nodes and splats; lists are joined, empty fields left out.
  assert.deepEqual(
    keysetOf(
      {
        '@key': ['account.sourceId', 'member[*].handle', 'missing', { key: 'kind', value: 'dm' }],
        account: { sourceId: 'A1' },
        member: [{ handle: 'ada' }, { handle: 'grace' }],
      },
      'slack'
    ),
    { 'account.sourceId': 'A1', 'member[*].handle': 'ada,grace', 'kind:dm': 'dm' }
  );
  // An `action.` field is read from the action the node is in.
  assert.deepEqual(
    keysetOf({ '@key': ['action.startTime'] }, 'apple-notes', { startTime: '2026-10-01' }),
    { 'action.startTime': '2026-10-01' }
  );
});

test('a URL names the same node whichever source saw it', () => {
  const url = 'https://example.com/x';
  const byUrl = { '@type': 'WebPage', '@key': ['url'], url };
  assert.deepEqual(keysetOf(byUrl, 'safari'), { source: URL_SOURCE, url });
  assert.equal(nodeKey(byUrl, 'safari'), nodeKey(byUrl, 'chrome'));
  // A node whose key has no values falls back to its url, then to the file it is.
  assert.equal(nodeKey({ '@type': 'WebPage', '@key': ['sourceId'], url }), nodeKey(byUrl));
  assert.equal(
    nodeKey({ '@type': 'ImageObject', '@key': ['sourceId'], attachmentCid: 'bafk' }),
    generateKeysetCID({ attachmentCid: 'bafk' })
  );
});

test('an @id is the identity already, and must agree with a key', () => {
  const keyed = { '@type': 'Book', '@key': ['source', 'sourceId'], sourceId: '12345' };
  const id = nodeKey(keyed, 'goodreads');
  assert.equal(id, '3ui7iw46snxiprenycrnfjzgoxnpeqxnu44ys3w4zb63gmuvlojq');
  assert.equal(nodeKey({ '@type': 'Book', '@id': id }), id);
  assert.equal(nodeKey({ ...keyed, '@id': id }, 'goodreads'), id);
  assert.throws(() => nodeKey({ ...keyed, '@id': 'other' }, 'goodreads'), /does not match/);
  assert.throws(() => nodeKey({ '@type': 'Book' }), /neither @key nor @id/);
});
