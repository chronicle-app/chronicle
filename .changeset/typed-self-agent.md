---
'@chronicle.app/etl': minor
'@chronicle.app/icloud': minor
---

`selfAgent()` now returns the schema node for its `type`: a `Person` by default, an `Agent` for `type: 'Agent'`. `type` is limited to `Agent` and its subtypes, and `sameAs` takes schema entities or strings. `buildICloudPersonSchema()` returns `Promise<Person>`, never null, and takes lookup options. With no readable iCloud account it returns the `@me` fallback Person keyed by `['@type', 'source']`. `@chronicle.app/icloud` now has `@chronicle.app/schema` as a peer dependency.
