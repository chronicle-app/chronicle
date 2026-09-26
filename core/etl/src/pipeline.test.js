import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChronicleTransformer,
  DispatchingTransformer,
  DownloadAttachmentsTransformer,
  Extractor,
  FlattenTransformer,
  JsonLoader,
  Loader,
  NullTransformer,
  Runner,
  Transformer,
} from '../dist/index.js';

// All identifiers and records in this file are synthetic fixtures.
class FixtureExtractor extends Extractor {
  static source = 'fixture';
  static strategy = 'memory';
  static delivery = 'export';
  static recordTypes = ['items'];
  constructor(items, config = {}) {
    super(config);
    this.items = items;
  }

  async determineCount() {
    return this.items.length;
  }

  async *extract() {
    let count = 0;
    try {
      for (const data of this.items) {
        if (this.shouldStopExtracting(count)) return;
        count++;
        yield this.createRecord(data, { recordType: data.kind ?? 'items' });
      }
    } finally {
      this.closed = true;
    }
  }
}

class FixtureTransformer extends ChronicleTransformer {
  async transform({ data }) {
    return [
      {
        '@type': 'Action',
        '@key': ['sourceId'],
        sourceId: data.id,
        object: { '@type': 'Entity', '@key': ['url'], url: data.url, name: data.title },
      },
    ];
  }
}

class MemoryLoader extends Loader {
  records = [];
  async load(record) {
    this.records.push(record);
    return { success: true, record };
  }
}

async function collect(runner) {
  const logs = [];
  try {
    await runner.setup();
    for await (const log of runner.run()) logs.push(log);
  } finally {
    await runner.teardown();
  }
  return logs;
}

test('extracts, transforms, validates and serializes with the minimal schema and no store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-etl-'));
  try {
    const output = join(directory, 'record.json');
    const runner = new Runner({ streamExtraction: true, quiet: true })
      .addExtractor(
        new FixtureExtractor([{ id: 'fixture-1', url: 'https://example.com/1', title: 'Example' }])
      )
      .addTransformer(new FixtureTransformer({ quiet: true }))
      .addLoader(new JsonLoader({ output }));
    const [log] = await collect(runner);
    assert.equal(log.results[0].success, true);
    assert.equal(log.record.schema, 'raw');
    const transformed = log.results[0].record;
    assert.equal(transformed.schema, 'chronicle');
    assert.equal(transformed.extraction.source, 'fixture');
    assert.equal(transformed.transformations.length, 1);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      '@type': 'Action',
      '@key': ['sourceId'],
      sourceId: 'fixture-1',
      object: { '@type': 'Entity', '@key': ['url'], url: 'https://example.com/1', name: 'Example' },
    });
    assert.equal('@assertedAt' in transformed.data, false);
    assert.equal('@asserts' in transformed.data.object, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('preserves streaming and buffered extraction, post-filter limits, and iterator cleanup', async () => {
  for (const streamExtraction of [true, false]) {
    const extractor = new FixtureExtractor([{ kind: 'skip' }, { kind: 'keep' }, { kind: 'keep' }]);
    const loader = new MemoryLoader();
    const runner = new Runner({ streamExtraction, recordTypes: ['keep'], limit: 1, quiet: true })
      .addExtractor(extractor)
      .addLoader(loader);
    assert.equal((await collect(runner)).length, 1);
    assert.equal(loader.records[0].extraction.recordType, 'keep');
    assert.equal(extractor.closed, true);
  }
});

test('chained transformers preserve fan-out, filtering, and raw presentation output', async () => {
  class Split extends Transformer {
    async transform({ data }) {
      return data.keep ? [{ nested: { value: 1 } }, { nested: { value: 2 } }] : [];
    }
  }
  const loader = new MemoryLoader();
  const runner = new Runner({ quiet: true })
    .addExtractor(new FixtureExtractor([{ keep: true }, { keep: false }]))
    .addTransformer(new Split())
    .addTransformer(new NullTransformer())
    .addTransformer(new FlattenTransformer())
    .addLoader(loader);
  const logs = await collect(runner);
  assert.equal(logs[0].results.length, 2);
  assert.equal(logs[1].filtered, true);
  assert.deepEqual(
    loader.records.map(record => record.data),
    [{ 'nested.value': 1 }, { 'nested.value': 2 }]
  );
  assert.equal(loader.records[0].transformations.length, 3);
  assert.equal(loader.records[0].schema, 'raw');
});

test('invalid Chronicle output is reported and never loaded', async () => {
  class MissingIdentity extends ChronicleTransformer {
    async transform() {
      return [{ '@type': 'Action', '@synthetic': true }];
    }
  }
  const loader = new MemoryLoader();
  const [log] = await collect(
    new Runner({ quiet: true })
      .addExtractor(new FixtureExtractor([{}]))
      .addTransformer(new MissingIdentity())
      .addLoader(loader)
  );
  assert.match(log.error, /identity/);
  assert.equal(loader.records.length, 0);

  // Every schema marker a transformer can declare triggers validation.
  for (const schema of [
    'chronicle',
    'chronicle:v1',
    'https://schema.chronicle.app/v1',
    'https://ontology.chronicle.app/v1',
  ]) {
    class Invalid extends Transformer {
      static outputSchema = schema;
      async transform() {
        return [
          {
            '@type': 'Action',
            '@key': ['sourceId'],
            sourceId: 'fixture',
            object: { '@type': 'Book' },
          },
        ];
      }
    }
    const loader = new MemoryLoader();
    const [log] = await collect(
      new Runner({ quiet: true })
        .addExtractor(new FixtureExtractor([{}]))
        .addTransformer(new Invalid())
        .addLoader(loader)
    );
    assert.equal(log.validationErrors.length, 1);
    assert.equal(loader.records.length, 0);
  }
});

test('reports transform and load-result errors; extraction and thrown loader errors propagate', async () => {
  class Throws extends Transformer {
    async transform() {
      throw new Error('transform failure');
    }
  }
  const [log] = await collect(
    new Runner({ quiet: true })
      .addExtractor(new FixtureExtractor([{}]))
      .addTransformer(new Throws())
  );
  assert.match(log.error, /transform failure/);
  class FailedLoader extends Loader {
    async load(record) {
      return { success: false, record, error: 'load failure' };
    }
  }
  const [failed] = await collect(
    new Runner({ quiet: true })
      .addExtractor(new FixtureExtractor([{}]))
      .addLoader(new FailedLoader())
  );
  assert.equal(failed.results[0].success, false);
  class ThrowingLoader extends Loader {
    async load() {
      throw new Error('write failed');
    }
  }
  await assert.rejects(
    collect(
      new Runner({ quiet: true })
        .addExtractor(new FixtureExtractor([{}]))
        .addLoader(new ThrowingLoader())
    ),
    /write failed/
  );
  class BrokenExtractor extends FixtureExtractor {
    async *extract() {
      yield* super.extract();
      throw new Error('read failed');
    }
  }
  for (const streamExtraction of [true, false]) {
    await assert.rejects(
      collect(new Runner({ quiet: true, streamExtraction }).addExtractor(new BrokenExtractor([]))),
      /read failed/
    );
  }
});

test('teardown attempts every resource in order, even after a failed teardown or setup', async () => {
  const order = [];
  class Source extends FixtureExtractor {
    async teardown() {
      order.push('extractor');
    }
  }
  class Transform extends NullTransformer {
    async teardown() {
      order.push('transformer');
    }
  }
  class First extends MemoryLoader {
    async teardown() {
      order.push('first');
      throw new Error('flush failed');
    }
  }
  class Second extends MemoryLoader {
    async teardown() {
      order.push('second');
    }
  }
  const runner = new Runner({ quiet: true })
    .addExtractor(new Source([]))
    .addTransformer(new Transform())
    .addLoader(new First())
    .addLoader(new Second());
  await runner.setup();
  await assert.rejects(runner.teardown(), AggregateError);
  await runner.teardown();
  assert.deepEqual(order, ['first', 'second', 'transformer', 'extractor']);

  order.length = 0;
  class PartialSource extends FixtureExtractor {
    async teardown() {
      order.push('extractor');
    }
  }
  class Broken extends MemoryLoader {
    async setup() {
      throw new Error('setup failed');
    }

    async teardown() {
      order.push('partial loader');
    }
  }
  class Unused extends MemoryLoader {
    async teardown() {
      order.push('unused');
    }
  }
  const partial = new Runner({ quiet: true })
    .addExtractor(new PartialSource([]))
    .addLoader(new Broken())
    .addLoader(new Unused());
  await assert.rejects(collect(partial), /setup failed/);
  assert.deepEqual(order, ['partial loader', 'extractor']);
});

test('dispatch routes by record type and tears down instantiated children', async () => {
  let tornDown = 0;
  class Child extends Transformer {
    static outputSchema = 'custom';
    async transform({ data }) {
      return [{ routed: data.kind }];
    }

    async teardown() {
      tornDown++;
    }
  }
  class Dispatcher extends DispatchingTransformer {
    static routes = { known: Child };
  }
  const loader = new MemoryLoader();
  const logs = await collect(
    new Runner({ quiet: true })
      .addExtractor(new FixtureExtractor([{ kind: 'known' }, { kind: 'unknown' }]))
      .addTransformer(new Dispatcher())
      .addLoader(loader)
  );
  assert.equal(logs[1].filtered, true);
  assert.deepEqual(loader.records[0].data, { routed: 'known' });
  assert.equal(loader.records[0].schema, 'custom');
  assert.equal(tornDown, 1);
});

test('attachment downloads embed the bytes and leave other fields alone', async () => {
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const transformer = new DownloadAttachmentsTransformer({ quiet: true });
  const [output] = await transformer.performTransform({
    data: {
      timestamp,
      image: { '@type': 'ImageObject', url: 'data:text/plain;base64,Zml4dHVyZQ==' },
    },
    schema: 'raw',
    transformations: [],
    extraction: { source: 'fixture', delivery: 'export' },
    context: {},
    toString: 'fixture',
  });
  assert.equal(output.data.timestamp, timestamp);
  assert.equal(output.data.image.contentData, 'data:text/plain;base64,Zml4dHVyZQ==');
  await transformer.teardown();
});
