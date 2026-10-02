# @chronicle.app/etl

## 0.4.0

### Minor Changes

- 9358671: Redesign extraction output. A run shows a live line on stderr (spinner, bar, count, rate, clock, and the record in hand) and ends with a one-line summary, with a hint when the default `--limit` cut it short. The CSV and table loaders show readable columns: no JSON-LD bookkeeping, nested nodes as their labels, lists joined, and every record's columns. The table fits the terminal, moves constant columns into a caption, and prints a single record as a card. `--columns schema` keeps every Chronicle schema property as its own dotted column instead. After CSV or table output, stderr hints at the columns the table had no room for and at `--columns schema` when it would show more.
- 2148753: Report extraction through output events. Everything a run says on stderr (progress, notices, record errors, the summary, and hints) is now an event rendered by one of three sinks, chosen with `--log-format pretty|plain|json`: pretty on a terminal, plain lines stamped with the time otherwise, and JSON lines for supervisors, with personal fields redacted. A flood of the same record error shows three examples and a count. Plugin warnings now print when stdout is piped instead of being silenced. `@chronicle.app/logging` loggers emit events to a sink the host hands over (`Runner` takes `sink` and `run`), no longer set chalk's global color level, and drop the `theme` option. `TableLoader` moves from `@chronicle.app/etl` into the CLI; etl now exports `Rows`, `columnsOption`, and `LABELS`. Nothing in Chronicle writes to the console any more: every message goes through a logger, a host can redirect all of them with `setDefaultSink`, and during a run anything a plugin or dependency writes to the console becomes its diagnostics on the run's sink instead of reaching stdout. Without a known total, the live line shows a spinner and a count instead of a bar. Repeated messages no longer flood stderr: messages that repeat (by key, or by scope and message with numbers ignored) show three examples, then a roll-up at most every five seconds with a count and how often each field value came up. `--delay <ms>` now waits before each extracted record rather than each transform, so it slows the whole run, including the read in a buffered run. `chronicle extract help [source]` shows the command's or a source's help, `chronicle extract --help` points to per-source help, and `--list-types` now lists just the record kinds and the strategies that carry them, one per line. When records print to the terminal, the live line still shows while the run starts and reads, and steps aside before the first record. The summary adds how many payloads were written when that differs from the records read, less skipped ones, and at narrow widths drops the destination, written, skipped, and time before cutting counts, never the failure count. Roll-ups print on schedule even when a group goes quiet, and the live line shows `writing <file>` while buffered output flushes. The Are.na, Bluesky, and Google Reader transformers no longer log twice per record. The default `--limit` hint now reads `first 100 · use --limit 0 for all`, adds `of N` when the source reports its size, and appears only when the limit actually left records unread: the runner reads one record past the default limit to know (`Runner` `peek` option and `truncated`). With `--stream` and a known size, the bar measures against the limit rather than the whole source.
- 32d4b05: Record kinds can follow the source (`chronicle extract github stars gists`), and kinds read by separate extractors now run together instead of failing as ambiguous: newest first when each extractor implements the new `occurredAt(record)` hook, one after another otherwise. `-t all` reads every kind, `-t defaults` the plugin's defaults. A plugin that declares no default kinds gets a picker on a bare run (space selects, enter starts, `a` all, `d` defaults), and outside a terminal an error saying how to name kinds; GitHub declares none. A run of several kinds says which it reads, and which it leaves out. The run summary puts the outcome on one line and a line per kind under it.
- e6a3487: The `Runner` reports its own run: `progress` as it reads, processes, and writes records, a keyed `error` event for each failed record operation, and a `summary` with the run's totals once a completed run is torn down. A host that drives the `Runner` directly, such as a server running ETL, gets the same events the CLI shows without re-implementing the counting. `runner.stats` holds the totals, `title` and `output` label the run, `Extractor.recordLimit()` exposes an extractor's limit, and `@chronicle.app/logging` exports the `ProgressFields` and `SummaryFields` shapes. The CLI's output is unchanged.
- 8bfee48: `sampleTransform`, `shapesOf`, and `renderShapes` sketch what a plugin's transformer makes of its records: for each record type, a tree of the nodes it becomes, with each node's key and properties, marking the ones that are sometimes absent, lists, or computed in the transformer rather than copied from the record. The GitHub and Hacker News plugins keep the sketch in a generated `SHAPES.md`, checked by a test and rewritten with `npm run shapes`.
- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.

### Patch Changes

- Updated dependencies [61ad43e]
- Updated dependencies [2148753]
- Updated dependencies [e6a3487]
- Updated dependencies [59904c0]
  - @chronicle.app/schema@0.4.0
  - @chronicle.app/logging@0.4.0

## 0.3.0

### Minor Changes

- d5f2f96: `ChronicleTransformer` stamps `@assertedAt` on each payload that doesn't set one: an event at its own `timestamp`, `startTime`, or `endTime` (none without one), and a snapshot at the extraction's read time. `Base` declares `@assertedAt` as a date or string.
- 983fa92: Add the helpers that API sources use: `ApiProxy`, a base class for a source's HTTP client that maps 401 and 429 responses to `ApiAuthError` and `ApiRateLimitError`, and the `paginateOffset`, `paginateByPage`, and `paginateCursor` strategies. Add `htmlToText`, `htmlToMarkdown`, `decodeEntities`, `looksLikeHtml`, and `tokenizeHtml` for sources that store HTML as content.
- cac20e0: Add `ArchiveExtractor`, a base for takeout-style exports read in place; `MergingExtractor`, which merges several newest-first child extractors into one newest-first stream under a single limit; and `SystemInfo`, which reads the user's name, hostname, and platform identifier on macOS, Linux, and Windows.
- 350ec02: Declare `keyOf`, `newestFirst` and `frontierThreshold` on `Extractor` so plugins can state their source identity and ordering ahead of an incremental-import cursor. Nothing reads them yet; extraction is unchanged.
- f400092: `chronicle plugins new <name>` creates a plugin of your own and adds it. It asks how the data reaches you (a CSV or JSON file, an export folder, an app's SQLite database, a web API, or something else) and starts the extractor on the matching base class. The plugin has an empty transformer, the `chronicle` manifest, a smoke test, a README, and an `AGENTS.md` that lists what to fill in next for that kind of source, for you or a coding agent. `--from` answers the question without a terminal. The TypeScript runs without a build, and its tsconfig allows only syntax Node can strip. `chronicle extract <source> --preview` prints the first five records as readable text. On Node.js 22.13 to 22.17, the CLI relaunches itself once with type stripping when a TypeScript plugin may run. The CLI shares `@chronicle.app/etl-sqlite` with plugins alongside `etl`, `schema`, and `auth`, and `@chronicle.app/etl` exports `z`, so a plugin can extend `Extractor.schema` without its own copy of zod.
- acb79bc: Extractors can pass `createRecord(data, context, { assertedAt })` when they know when the source observed a record, such as an API's per-item fetch time. It is kept as `extraction.recordAssertedAt` and becomes the payload's `@assertedAt` ahead of the event and snapshot defaults, unless the payload sets its own.
- 78086b7: `ChronicleTransformer` marks every node of a snapshot source's payload `@asserts: ['*']`, a complete read of its current values, so values that have since gone away can be closed. `Base` declares `@asserts`. Things tasks now carry the marker. Payloads are labelled by source, type, and their end, start, or event time instead of their `sourceId`.
- 0f72f02: `selfAgent()` now returns the schema node for its `type`: a `Person` by default, an `Agent` for `type: 'Agent'`. `type` is limited to `Agent` and its subtypes, and `sameAs` takes schema entities or strings. `buildICloudPersonSchema()` returns `Promise<Person>`, never null, and takes lookup options. With no readable iCloud account it returns the `@me` fallback Person keyed by `['@type', 'source']`. `@chronicle.app/icloud` now has `@chronicle.app/schema` as a peer dependency.

### Patch Changes

- Updated dependencies [d8d36ef]
- Updated dependencies [3431450]
- Updated dependencies [65ddcca]
- Updated dependencies [80598fa]
- Updated dependencies [5c96cd7]
- Updated dependencies [93a5216]
- Updated dependencies [8ae2741]
- Updated dependencies [28a429d]
- Updated dependencies [9bed946]
- Updated dependencies [fe75616]
- Updated dependencies [d6b5830]
- Updated dependencies [350ec02]
- Updated dependencies [86968a9]
- Updated dependencies [92674c9]
- Updated dependencies [9b56efb]
- Updated dependencies [d5f2f96]
- Updated dependencies [17f4d09]
- Updated dependencies [b9ee0b1]
- Updated dependencies [d5f2f96]
- Updated dependencies [acb79bc]
- Updated dependencies [78086b7]
  - @chronicle.app/schema@0.3.0
  - @chronicle.app/logging@0.3.0

## 0.2.0

### Patch Changes

- d71b202: Upgrade `csv-parse` to 7, which fixes a prototype-replacement advisory in the `columns` option (GHSA-8cw4-87c7-c6xx), and the CLI's `glob` to 13, replacing a deprecated release.
- Updated dependencies [63bbde7]
  - @chronicle.app/schema@0.2.0
  - @chronicle.app/logging@0.2.0
