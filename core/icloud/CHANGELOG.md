# @chronicle.app/icloud

## 0.3.0

### Minor Changes

- fd58a46: Read the Apple Account from the system Accounts database when MobileMeAccounts is empty, as it is on newer macOS, so the account owner is keyed by their DSID again. `buildICloudPersonSchema` now returns `null` when no account can be read, instead of a Person keyed only by `['@type', 'source']` that every account-less owner shared; Safari and iMessage leave the owner out in that case. iMessage's SMS owner with no identifier is left out the same way.
- 0f72f02: `selfAgent()` now returns the schema node for its `type`: a `Person` by default, an `Agent` for `type: 'Agent'`. `type` is limited to `Agent` and its subtypes, and `sameAs` takes schema entities or strings. `buildICloudPersonSchema()` returns `Promise<Person>`, never null, and takes lookup options. With no readable iCloud account it returns the `@me` fallback Person keyed by `['@type', 'source']`. `@chronicle.app/icloud` now has `@chronicle.app/schema` as a peer dependency.

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
