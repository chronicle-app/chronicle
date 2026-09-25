import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvLoader, JsonLoader } from '../dist/index.js';

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

// The CLI test covers each loader end to end; this covers escaping it can't reach.
test('JSON and CSV file output escape quotes, controls and delimiters and render dates', async () => {
  const data = { 'quoted"key': 'a\nb\t"c"\\', when: new Date('2020-01-01T00:00:00Z') };
  assert.equal(
    await fileOutput(JsonLoader, [data, { next: true }]),
    `${JSON.stringify(data, null, 2)}\n${JSON.stringify({ next: true }, null, 2)}\n`
  );
  assert.equal(
    await fileOutput(CsvLoader, [
      { name: 'a,"b"', nested: { value: 2 }, list: ['x'], when: new Date('2020-01-01T00:00:00Z') },
      { name: 'next' },
    ]),
    'name,nested.value,list.0,when\n"a,""b""",2,x,2020-01-01T00:00:00.000Z\nnext,,,\n'
  );
  assert.equal(
    await fileOutput(CsvLoader, [{ a: 1, b: 2 }], { headers: false, delimiter: ';' }),
    '1;2\n'
  );
});
