import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CsvLoader, JsonLoader, formatJson } from '../dist/index.js';

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

// A Chronicle node with the bookkeeping every node carries.
const node = (extra = {}) => ({
  '@type': 'ExecuteAction',
  '@key': ['@type', 'source'],
  source: 'shell',
  agent: {
    '@type': 'Person',
    '@key': ['handle'],
    source: 'shell',
    handle: 'me',
    sameAs: ['@me'],
  },
  object: { '@type': 'Command', body: 'echo hi' },
  ...extra,
});

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
    'name,nested.value,list,when\n"a,""b""",2,x,2020-01-01T00:00:00.000Z\nnext,,,\n'
  );
  // Chronicle nodes: bookkeeping stays out, nested nodes show their label,
  // lists join, and a column first seen on a later record still appears.
  assert.equal(
    await fileOutput(CsvLoader, [
      node(),
      node({
        participant: [
          { '@type': 'Person', name: 'A' },
          { '@type': 'Person', name: 'B' },
        ],
      }),
    ]),
    '@type,agent,object,participant\nExecuteAction,me,echo hi,\nExecuteAction,me,echo hi,A; B\n'
  );
  // Schema columns: every schema property as a dotted path; only @key and
  // other JSON-LD bookkeeping stay out.
  assert.equal(
    await fileOutput(CsvLoader, [node({ '@assertedAt': 'x' })], { columns: 'schema' }),
    '@type,source,agent.@type,agent.source,agent.handle,agent.sameAs,object.@type,object.body\n' +
      'ExecuteAction,shell,Person,shell,me,@me,Command,echo hi\n'
  );
  assert.equal(
    await fileOutput(CsvLoader, [{ a: 1, b: 2 }], { headers: false, delimiter: ';' }),
    '1;2\n'
  );
});

test('JSON keeps what fits on one line, packs long lists of values, and parses the same', () => {
  const long = 'x'.repeat(100);
  const data = node({
    when: new Date('2020-01-01T00:00:00Z'),
    skipped: undefined,
    tags: [long],
    paths: Array.from({ length: 6 }, (_, i) => `agent.memberOf[${i}].handle`),
    empty: {},
  });
  const text = formatJson(data);
  assert.equal(
    text,
    `{
  "@type": "ExecuteAction",
  "@key": ["@type", "source"],
  "source": "shell",
  "agent": {
    "@type": "Person",
    "@key": ["handle"],
    "source": "shell",
    "handle": "me",
    "sameAs": ["@me"]
  },
  "object": { "@type": "Command", "body": "echo hi" },
  "when": "2020-01-01T00:00:00.000Z",
  "tags": [
    "${long}"
  ],
  "paths": [
    "agent.memberOf[0].handle", "agent.memberOf[1].handle", "agent.memberOf[2].handle",
    "agent.memberOf[3].handle", "agent.memberOf[4].handle", "agent.memberOf[5].handle"
  ],
  "empty": {}
}`
  );
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(data)));
  assert.ok(text.split('\n').every(line => line.length <= 100 || line.includes(long)));
});
