import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderShapes, sampleTransform, shapesOf } from '../dist/index.js';

const sample = (input, outputs, recordType = 'posts') => ({ recordType, input, outputs });
const KEY = ['@type', 'source', 'sourceId'];
const publish = (id, object) => ({
  '@type': 'PublishAction',
  '@key': KEY,
  source: 'example',
  sourceId: String(id),
  object,
});
const post = (id, fields) => ({ '@type': 'Post', '@key': KEY, source: 'example', ...fields });
const link = url => ({ '@type': 'Entity', '@key': ['url'], url });

function sketch(samples) {
  const markdown = renderShapes(shapesOf(samples), { title: 'Example' });
  return markdown.slice(markdown.indexOf('```ts\n') + 6, markdown.lastIndexOf('```'));
}

test('each record type is a tree of the nodes it becomes, with their keys', () => {
  const tree = sketch([
    sample({ id: 701, title: 'Rye', state: 'OPEN', link: 'https://example.com/rye' }, [
      publish(701, {
        ...post(701, { name: 'Rye', visibility: 'open', score: 3 }),
        references: [link('https://example.com/rye')],
      }),
    ]),
    sample({ id: 802, title: 'Spelt', state: 'CLOSED' }, [
      publish(802, post(802, { name: 'Spelt', visibility: 'closed', score: 5 })),
    ]),
  ]);

  // Copied (name ← title) and converted (visibility ← lower(state)) values are
  // plain; nothing in the record says 3 or 5, so the transformer computed it.
  // A key without `source` is shared across sources.
  assert.equal(
    tree,
    [
      'PublishAction key(sourceId) {',
      '  sourceId',
      '  object: Post key(sourceId) {',
      '    name, visibility, score*',
      '    references[]?: Entity key(url, any source) { url }',
      '  }',
      '}',
      '',
    ].join('\n')
  );
});

test('a value the record lacks is computed, unless it never changes', () => {
  const tree = sketch([
    sample({ text: 'Hello <i>there</i>' }, [
      publish(1, post(1, { body: 'Hello there', tag: 'x' })),
    ]),
    sample({}, [publish(2, post(2, { tag: 'x' }))], 'others'),
  ]);
  // `body` was seen once and matches nothing in the record; `tag` is the same
  // everywhere it appears, so it's a constant.
  assert.match(tree, /object: Post key\(sourceId\) \{ body\*, tag \}\n/);
});

/** One record through a stand-in extractor and transformer, becoming one node with `body`. */
function sampleOf(body, options) {
  const extractor = {
    async setup() {},
    async teardown() {},
    async *extract() {
      yield { data: {}, context: {}, extraction: { recordType: 'posts' } };
    },
  };
  const transformer = { performTransform: async () => [{ data: publish(1, post(1, { body })) }] };
  return sampleTransform(extractor, transformer, options);
}

test('a sample whose body is HTML fails, unless the plugin allows markup', async () => {
  await assert.rejects(sampleOf('<p>Hello <b>there</b></p>'), /posts: Post\.body holds HTML/);
  // Markdown, and text that only mentions a tag, pass.
  await sampleOf('**Hello** <there>, see <https://example.com>.');
  // A plugin whose bodies are code says so.
  await sampleOf('echo "<p>hi</p>" > index.html', { allowMarkup: true });
});
