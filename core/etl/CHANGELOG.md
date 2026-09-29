# @chronicle.app/etl

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
