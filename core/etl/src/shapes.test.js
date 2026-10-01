import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderShapes, shapesOf } from '../dist/index.js';

const sample = (input, outputs, context = {}) => ({ recordType: 'posts', input, context, outputs });
const post = (id, fields) => ({
  '@type': 'PublishAction',
  '@key': ['@type', 'source', 'sourceId'],
  source: 'example',
  sourceId: String(id),
  object: { '@type': 'Post', '@key': ['@type', 'source', 'sourceId'], ...fields },
});

test('shapes say where each output value came from', () => {
  const shapes = shapesOf([
    sample({ id: 701, title: 'Rye', state: 'OPEN', at: '2025-01-01T00:00:00Z' }, [
      post(701, {
        name: 'Rye',
        url: 'https://example.com/p/701',
        visibility: 'open',
        datePublished: new Date('2025-01-01T00:00:00Z'),
        score: 3,
      }),
    ]),
    sample({ id: 802, title: 'Spelt', state: 'CLOSED', at: '2025-02-01T00:00:00Z' }, [
      post(802, {
        name: 'Spelt',
        url: 'https://example.com/p/802',
        visibility: 'closed',
        datePublished: new Date('2025-02-01T00:00:00Z'),
        score: 5,
      }),
    ]),
  ]);
  const markdown = renderShapes(shapes, { title: 'Example' });

  assert.match(markdown, /- PublishAction —object→ Post/);
  assert.match(markdown, /\| `id` \| number \| always \|/);
  assert.match(markdown, /\| `source` \| text \| always \| = "example" \|/);
  assert.match(markdown, /\| `sourceId` \| text \| always \| String\(id\) \|/);
  assert.match(markdown, /\| `name` \| text \| always \| title \|/);
  assert.match(markdown, /\| `url` \| text \| always \| …\{id\}… \|/);
  assert.match(markdown, /\| `visibility` \| text \| always \| lower\(state\) \|/);
  assert.match(markdown, /\| `datePublished` \| date \| always \| date\(at\) \|/);
  // Nothing in the input says 3 or 5: the transformer decided.
  assert.match(markdown, /\| `score` \| number \| always \| computed \|/);
});

test('a value from a different input each time varies; a value seen once says so', () => {
  const markdown = renderShapes(
    shapesOf([
      sample({ comment: { body: 'Hello there' } }, [post(1, { body: 'Hello there' })]),
      sample({ review: { body: 'Looks good' } }, [post(2, { body: 'Looks good' })]),
      { recordType: 'once', input: {}, outputs: [post(3, {})] },
    ]),
    { title: 'Example' }
  );
  assert.match(
    markdown,
    /\| `body` \| text \| always \| varies: comment\.body \\\| review\.body \|/
  );
  assert.match(
    markdown,
    /## once[\s\S]*\| `source` \| text \| always \| = "example" \(seen once\) \|/
  );
});
