# @chronicle.app/etl

Chronicle's extraction → transformation → serialization framework, copied and
narrowed from the existing ETL package. Node.js 22.13+, ESM, TypeScript declarations.
No CLI, credentials, database, or archive store is required.

## A pipeline

An `Extractor` yields raw record envelopes. A `Transformer` returns zero, one, or
many payloads per record; zero deliberately filters it out. `ChronicleTransformer`
validates its output against the minimal schema. A `Loader` writes each payload.

```js
import { ChronicleTransformer, Extractor, JsonLoader, Runner } from '@chronicle.app/etl';

class ExampleExtractor extends Extractor {
  static source = 'example';
  static strategy = 'memory';
  static delivery = 'export';
  static recordTypes = ['items'];

  async *extract() {
    // Synthetic example data; a real extractor preserves source-issued identifiers.
    yield this.createRecord({ id: 'example-action-1', url: 'https://example.com/item/1' });
  }
}

class ExampleTransformer extends ChronicleTransformer {
  async transform({ data }) {
    return [
      {
        '@type': 'Action',
        '@key': ['sourceId'],
        sourceId: data.id,
        object: { '@type': 'Entity', '@key': ['url'], url: data.url },
      },
    ];
  }
}

const runner = new Runner({ streamExtraction: true, quiet: true })
  .addExtractor(new ExampleExtractor({}))
  .addTransformer(new ExampleTransformer())
  .addLoader(new JsonLoader());

try {
  await runner.setup();
  for await (const log of runner.run()) {
    if (log.error || log.validationErrors?.length || log.results.some(result => !result.success)) {
      throw new Error(`Extraction failed: ${JSON.stringify(log)}`);
    }
  }
} finally {
  await runner.teardown();
}
```

For TypeScript, override inherited concrete members with `override`; use
`Extractor<typeof YourExtractor>` / `Loader<typeof YourLoader>` when extending the
static Zod config schema. Record envelopes preserve extraction metadata, raw
context, schema marker, display text, and transformation history. Data written by
the serializers is the payload (`record.data`), not the whole envelope.

## Execution and errors

`setup()` initializes the extractor/loaders and, unless `streamExtraction: true`,
buffers extracted records. `run()` yields one `RunLog` per extracted record.
Transformation failures and invalid Chronicle payloads are reported in those logs;
callers must inspect them. Loaders can return unsuccessful `LoadResult`s. Thrown
extractor/loader exceptions propagate. Raw/custom schema records bypass Chronicle
validation; Chronicle-marked records must validate as Actions, with nested Entities.
`validateSchema: false` disables the runner's check, but does not disable a
`ChronicleTransformer`'s own validation.

Always call `teardown()` in a `finally` block, including after setup failures. It
flushes initialized loaders, then releases transformer and extractor resources,
attempting every cleanup even if one fails. Cleanup failures surface as an
`AggregateError`; repeated teardown is a no-op. Runner instances are single-setup.

`recordTypes` filters the raw stream before the runner's `limit`. Zero means no
limit. Extractor limits remain source-controlled via `shouldStopExtracting`; when
filtering mixed kinds, omit the extractor limit and use the runner's post-filter
limit. `since`/`until` are parsed config values whose filtering a source implements.
There is no known-record lookup, resume state, or implicit database access.

## Included output and transform helpers

| Export                   | Behavior                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JsonLoader`             | Writes successive pretty-printed JSON documents, overwriting a file on the first record and appending afterward; supports terminal coloring. This is not a single JSON array or JSONL stream. |
| `CsvLoader`              | Buffers flattened rows; columns come from the first record. Supports delimiter/quote/escape and optional headers.                                                                             |
| `YamlLoader`             | Buffers payloads; emits one object for one record or a sequence for several.                                                                                                                  |
| `TableLoader`            | Buffers flattened rows with optional headers; columns come from the first record.                                                                                                             |
| `NullTransformer`        | Passes payloads through.                                                                                                                                                                      |
| `FlattenTransformer`     | Flattens nested fields for presentation and marks output as raw.                                                                                                                              |
| `DispatchingTransformer` | Routes by extraction record type; unknown routes filter the record.                                                                                                                           |

All loaders accept an optional `output` path, otherwise write to stdout. CSV,
YAML, and table output is flushed at teardown; an empty input writes nothing.
Logging goes to stderr. Dates in JSON/CSV/table output use ISO strings.

## Migration boundary

The base contracts, runner transformation loop, routing, and four serializers come
from the existing package; its full implementation remains with private consumers.
This package is not yet a drop-in replacement for that full API. Changes here:

- Removed run trackers, destination settlement, absence detection, hashes/frontier
  cursors, and store-specific snapshot/completeness annotations. Extraction
  temporality/read time remain metadata only. No synthetic identity bypass.
- Fixed runner validation of the plain `chronicle` marker used by transformers.
- Fixed JSON colorizer escaping of string values and property names.
- Made cleanup idempotent and exhaustive after partial setup or cleanup failure.

Deferred until their consumers migrate: media object builders, attachment
downloading, API/archive/CSV source adapters, system and phone utilities, CLI flag
helpers, and additional presentation transforms. In particular, media helpers
would emit ImageObject/AudioObject/etc.; those types are intentionally absent from
the minimal ontology. No media vocabulary is added in this migration.

SQLite belongs exclusively in the later `etl-sqlite` adapter using built-in
`node:sqlite`, with read-only source opens and tests on Node 22.13+. This package
has no SQLite implementation or Knex/`better-sqlite3` dependency; CI audits the
installed tarball dependency tree for those libraries and private packages.

`npm run quality` builds and tests the workspace. `npm run packages:check` also
compiles and runs a complete ETL pipeline using installed tarballs outside the
monorepo. Publication and private-consumer cutover remain gated as described in
[RELEASING.md](../../RELEASING.md); neither repository's visibility changes.

MIT. See [LICENSE](LICENSE).
