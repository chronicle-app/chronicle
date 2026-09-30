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

| Export                           | Behavior                                                                                                                                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JsonLoader`                     | Writes successive pretty-printed JSON documents, overwriting a file on the first record and appending afterward; supports terminal coloring. This is not a single JSON array or JSONL stream.                                                                                     |
| `CsvLoader`                      | Buffers readable rows (see `recordRow`): bookkeeping dropped, nested nodes as their labels, lists joined; columns are the union across records. `columns: 'schema'` keeps every schema property as a dotted column instead. Supports delimiter/quote/escape and optional headers. |
| `YamlLoader`                     | Buffers payloads; emits one object for one record or a sequence for several.                                                                                                                                                                                                      |
| `recordRow`, `Rows`, `nodeLabel` | One record as readable columns, rows collected across records, and a node's one-line label; what the CSV loader and the CLI's table use.                                                                                                                                          |
| `NullTransformer`                | Passes payloads through.                                                                                                                                                                                                                                                          |
| `FlattenTransformer`             | Flattens nested fields for presentation and marks output as raw.                                                                                                                                                                                                                  |
| `DispatchingTransformer`         | Routes by extraction record type; unknown routes filter the record.                                                                                                                                                                                                               |

All loaders accept an optional `output` path, otherwise write to stdout. CSV and
YAML output is flushed at teardown; an empty input writes nothing. Dates in
JSON/CSV output use ISO strings.

## Logging

Extractors, transformers, and the runner log through `this.logger` from
`@chronicle.app/logging`. Each call becomes an event on a sink. Pass the host's
`sink` (and the `run` it belongs to) in the `Runner` config; at setup the runner
hands it to the extractor and transformers, so their events render the host's
way. Without one, each logs plain lines to stderr at the `quiet`/`verbose` level
of its config. Fields a plugin logs are marked personal.

The runner also reports the run itself, so every host sees a run the same
way: `progress` events as it reads records in (`reading`), processes them
(`loading`), and flushes the loaders (`writing`); a keyed `error` event for
each failed transform, validation, or load (`record.transform`,
`record.validation`, `record.load`); and, once a run that went through every
record is torn down, a `summary` whose fields hold the totals (`counts`,
`records`, `written`, `skipped`, `failed`, `durationMs`). `title` and `output`
in the config label it. `runner.stats` has the same totals as the run goes.
Plugins can't emit `progress` or `summary`.

A plugin that can't go on throws a typed error, re-exported from
`@chronicle.app/logging`: `AuthRequired`, `InputNotFound`, `PermissionDenied`,
`RateLimited`, or `ExtractorError` with a `code`. The runner reports any error
that ends `setup()` or `run()` as an `error` event with its code, exit code,
and hint, then rethrows it. `ApiAuthError` and `ApiRateLimitError` are the
typed ones. `fileError(error, path, what)` turns a missing or refused file
into `InputNotFound` or `PermissionDenied` (on macOS, with the Full Disk Access
hint), and `assertReadable(path)` checks a file that way before a library
opens it; `SqliteExtractor` does, for every SQLite source. A plugin that
succeeds but leaves something out calls `this.hint(message, { action })`,
which prints under the run's summary.

## Scope

This package covers extraction only: contracts, the runner transformation loop,
routing, and the loaders above. It does not track runs, settle destinations,
detect absences, or keep hash/frontier cursors. `ChronicleTransformer` marks
every node of a snapshot source's payload `@asserts: ['*']`, a complete read of
its current values, and stamps each payload's `@assertedAt`, when the
source observed it, unless the payload sets one. An event source's payload is
asserted at its own `timestamp`, `startTime`, or `endTime`, and gets none without
one. A snapshot source's payload is asserted at the extraction's read time. An
extractor that knows when the source observed a record passes it to
`createRecord(data, context, { assertedAt })`, and that time beats both defaults.
Every record goes through normal identity handling.

Media object builders, source-owner identity, and phone normalization helpers
support iMessage and iCloud enrichment. Attachments remain references; this
package does not copy their bytes. Attachment downloading, CLI flag helpers,
and additional presentation transforms are not included.

Three extractor and system helpers are shared by several sources:

- `ArchiveExtractor` is a base for takeout-style exports read in place from an
  `--input` directory. It reads JSON files, checks the since/until window,
  repairs the mojibake these exports write, and attaches the export's account
  info to each record's context. Layout knowledge stays in each plugin.
- `MergingExtractor` merges several child extractors' newest-first streams into
  one newest-first stream by the subclass's `sortKey`, and applies the limit to
  the merged output. Pair it with a `DispatchingTransformer`.
- `SystemInfo.getInstance()` returns the macOS, Linux, or Windows
  implementation, which reads the user's real name, username, hostname, and a
  stable platform identifier from the host. `SystemInfo.normalizeMachineName`
  reduces a hostname or device name to its first label, lowercased.

## API sources and HTML

`ApiProxy` is a base class for a source's HTTP client. It holds one axios client,
sends a bearer token once the subclass calls `setAccessToken`, and maps HTTP 401
to `ApiAuthError` and HTTP 429 to `ApiRateLimitError` (with `retryAfterSeconds`
from `Retry-After`). Other errors pass through. A subclass loads its own
credentials in `initialize()`. `paginateOffset`, `paginateByPage`, and
`paginateCursor` drive a fetch-page callback to the end of the results or to a
`limit`, waiting `pageDelayMs` between pages; `ApiProxy` exposes each with its
own page delay.

`htmlToText` and `htmlToMarkdown` render markup that a source stores as content,
such as a message body or a feed summary. Both return `undefined` for an empty
fragment and leave text without markup as written. `decodeEntities`,
`looksLikeHtml`, and `tokenizeHtml` are the pieces they are built from.

SQLite extraction lives in `@chronicle.app/etl-sqlite`, using built-in
`node:sqlite` and read-only source connections.

`npm run quality` builds and tests the workspace. `npm run packages:check` also
compiles and runs a complete ETL pipeline using installed tarballs outside the
monorepo. Publishing is described in [RELEASING.md](../../RELEASING.md).

MIT. See [LICENSE](LICENSE).
