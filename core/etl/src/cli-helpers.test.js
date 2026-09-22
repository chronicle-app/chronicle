import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CsvExtractor,
  FilterFieldsTransformer,
  SamplingTransformer,
  Base64TruncateTransformer,
  DownloadAttachmentsTransformer,
} from '../dist/index.js';
const record = data => ({
  data,
  schema: 'raw',
  transformations: [],
  extraction: { source: 'fixture', delivery: 'export' },
  context: {},
  toString: 'fixture',
});

test('field filtering preserves bracket paths and wildcard arrays', async () => {
  const transformer = new FilterFieldsTransformer({ fields: ['items[*].name', 'nested.value'] });
  const [output] = await transformer.performTransform(
    record({ items: [{ name: 'one' }, { name: 'two' }], nested: { value: 42 }, ignored: true })
  );
  assert.deepEqual(output.data, { 'items.name': ['one', 'two'], 'nested.value': 42 });
});

test('sampling boundary rates and base64 truncation', async () => {
  const input = record({ name: 'fixture', encoded: 'A'.repeat(200) });
  assert.deepEqual(await new SamplingTransformer({ rate: 0 }).performTransform(input), []);
  assert.equal((await new SamplingTransformer({ rate: 1 }).performTransform(input)).length, 1);
  const [output] = await new Base64TruncateTransformer({
    maxLength: 100,
    suffix: '...',
  }).performTransform(input);
  assert.equal(output.data.name, 'fixture');
  assert.equal(output.data.encoded.length, 103);
});

test('CSV extractor reads quoted rows and respects limit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chronicle-csv-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, 'input.csv');
  await writeFile(filename, 'name,value\n"fixture, one",42\nsecond,99\n');
  const extractor = new CsvExtractor({ filename, limit: 1 });
  const rows = [];
  try {
    for await (const row of extractor.extract()) rows.push(row);
  } finally {
    await extractor.teardown();
  }
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].data, { name: 'fixture, one', value: '42' });
});

test('attachment downloads embed synthetic bytes and preserve dates', async () => {
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const transformer = new DownloadAttachmentsTransformer({ quiet: true });
  const [output] = await transformer.performTransform(
    record({
      timestamp,
      image: { '@type': 'ImageObject', url: 'data:text/plain;base64,Zml4dHVyZQ==' },
    })
  );
  assert.equal(output.data.timestamp, timestamp);
  assert.equal(output.data.image.contentData, 'data:text/plain;base64,Zml4dHVyZQ==');
  await transformer.teardown();
});
