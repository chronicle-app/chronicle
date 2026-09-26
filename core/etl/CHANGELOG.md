# @chronicle.app/etl

## 0.3.0

### Minor Changes

- 350ec02: Declare `keyOf`, `newestFirst` and `frontierThreshold` on `Extractor` so plugins can state their source identity and ordering ahead of an incremental-import cursor. Nothing reads them yet; extraction is unchanged.
- 0f72f02: `selfAgent()` now returns the schema node for its `type`: a `Person` by default, an `Agent` for `type: 'Agent'`. `type` is limited to `Agent` and its subtypes, and `sameAs` takes schema entities or strings. `buildICloudPersonSchema()` returns `Promise<Person>`, never null, and takes lookup options. With no readable iCloud account it returns the `@me` fallback Person keyed by `['@type', 'source']`. `@chronicle.app/icloud` now has `@chronicle.app/schema` as a peer dependency.

### Patch Changes

- Updated dependencies [d8d36ef]
- Updated dependencies [350ec02]
  - @chronicle.app/schema@0.3.0
  - @chronicle.app/logging@0.3.0

## 0.2.0

### Patch Changes

- d71b202: Upgrade `csv-parse` to 7, which fixes a prototype-replacement advisory in the `columns` option (GHSA-8cw4-87c7-c6xx), and the CLI's `glob` to 13, replacing a deprecated release.
- Updated dependencies [63bbde7]
  - @chronicle.app/schema@0.2.0
  - @chronicle.app/logging@0.2.0
