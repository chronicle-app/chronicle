import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { CsvLoader, JsonLoader, TableLoader, YamlLoader, colorizeJson } from '../dist/index.js';

afterEach(() => mock.restoreAll());
const identity = value => value;

function record(data) {
  return {
    data,
    context: {},
    extraction: { source: 'fixture', delivery: 'export' },
    transformations: [],
    schema: 'raw',
    toString: 'fixture',
  };
}

async function fileOutput(LoaderClass, data, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-loaders-'));
  try {
    const output = join(directory, 'output.txt');
    const loader = new LoaderClass({ output, ...config });
    await loader.setup();
    for (const value of data) assert.equal((await loader.performLoad(record(value))).success, true);
    await loader.teardown();
    return await readFile(output, 'utf8');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('JSON file output writes once then appends, with quotes, controls and dates preserved', async () => {
  const data = { 'quoted"key': 'a\nb\t"c"\\', when: new Date('2020-01-01T00:00:00Z') };
  const output = await fileOutput(JsonLoader, [data, { next: true }]);
  assert.equal(
    output,
    `${JSON.stringify(data, null, 2)}\n${JSON.stringify({ next: true }, null, 2)}\n`
  );
});

test('colorized JSON preserves string and property escaping in both layouts', () => {
  const theme = Object.fromEntries(
    [
      'StringLiteral',
      'NumberLiteral',
      'BooleanLiteral',
      'NullLiteral',
      'StringKey',
      'Whitespace',
      'Brace',
      'Bracket',
      'Colon',
      'Comma',
    ].map(key => [key, identity])
  );
  const data = {
    'key"\n': 'line\n\t"quoted"\\',
    nested: [true, null, 3],
    when: new Date('2020-01-01T00:00:00Z'),
  };
  for (const singleLine of [true, false]) {
    assert.deepEqual(
      JSON.parse(colorizeJson(data, theme, singleLine)),
      JSON.parse(JSON.stringify(data))
    );
  }
});

test('CSV flattens nested fields and arrays, escapes delimiters/quotes, and renders dates', async () => {
  const output = await fileOutput(CsvLoader, [
    { name: 'a,"b"', nested: { value: 2 }, list: ['x'], when: new Date('2020-01-01T00:00:00Z') },
    { name: 'next' },
  ]);
  assert.equal(
    output,
    'name,nested.value,list.0,when\n"a,""b""",2,x,2020-01-01T00:00:00.000Z\nnext,,,\n'
  );
  assert.equal(
    await fileOutput(CsvLoader, [{ a: 1, b: 2 }], { headers: false, delimiter: ';' }),
    '1;2\n'
  );
});

test('YAML preserves nested structure and emits a sequence for multiple records', async () => {
  const data = { nested: { text: 'a: b\nsecond line' }, list: [1, 2] };
  assert.deepEqual(yaml.load(await fileOutput(YamlLoader, [data])), data);
  assert.deepEqual(yaml.load(await fileOutput(YamlLoader, [data, { other: true }])), [
    data,
    { other: true },
  ]);
});

test('table output includes flattened headers, values and ISO dates', async () => {
  const output = await fileOutput(TableLoader, [
    { nested: { name: 'Example' }, when: new Date('2020-01-01T00:00:00Z') },
  ]);
  assert.match(output, /nested.name/);
  assert.match(output, /Example/);
  assert.match(output, /2020-01-01T00:00:00.000Z/);
  assert.doesNotMatch(
    await fileOutput(TableLoader, [{ heading: 'value' }], { headers: false }),
    /heading/
  );
});

test('serializers write to stdout without mixing in progress logs', async () => {
  for (const LoaderClass of [JsonLoader, CsvLoader, YamlLoader, TableLoader]) {
    const chunks = [];
    const stdout = mock.method(process.stdout, 'write', chunk => {
      chunks.push(String(chunk));
      return true;
    });
    const stderr = mock.method(process.stderr, 'write', () => true);
    const loader = new LoaderClass();
    await loader.setup();
    await loader.performLoad(record({ name: 'Example' }));
    await loader.teardown();
    assert.ok(chunks.join('').includes('Example'));
    assert.equal(stderr.mock.callCount(), 0);
    stdout.mock.restore();
    stderr.mock.restore();
  }
});

test('buffered serializers emit nothing for an empty input', async () => {
  const stdout = mock.method(process.stdout, 'write', () => true);
  for (const LoaderClass of [CsvLoader, YamlLoader, TableLoader]) {
    const loader = new LoaderClass();
    await loader.setup();
    await loader.teardown();
  }
  assert.equal(stdout.mock.callCount(), 0);
});
