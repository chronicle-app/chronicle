# @chronicle.app/persistence

## 0.6.0

### Minor Changes

- 932a4b0: The vocabulary adds `DateRange`, a datatype for a stretch of time, all of it included: a date, such as `2026-05`, or an interval, such as `2026-05-04/2026-05-10` or `2026-05-14T16:00:00Z/2026-05-14T17:00:00Z`. `isDateRange` checks a string. A `DateTime` stays one moment, so `2026-05` as a `datePublished` is some moment in May, and as a `dateCovered` it's all of May.

  A `CreativeWork` can have a `dateCovered`, the period it's about, such as the day a journal entry describes or the years a novel is set in.

  `scheduledFor` takes the place of `scheduledStart` and `scheduledEnd` on an `Event`, so a plan changes as one value. A `Session` no longer has a planned period: it's what a person actually did, and a plan for it is an `Event` it can be part of. Google Calendar writes it: two instants for a timed event, and a date or two for an all-day one. Import your calendars again to give events already in a store a `scheduledFor`.

- f702c6a: Publish the store, `@chronicle.app/persistence`, and its query language, `@chronicle.app/cql`. The CLI now needs Node.js 22.16 or newer, for the full-text search and row reading the store uses in `node:sqlite`. Two experimental commands, not yet in the CLI's help, use the store: `chronicle import <source>` runs a source as `extract` does and puts its records in the store, as does `chronicle import <file>` for a file of records or piped ones, and `chronicle query <cql>` prints what matches as lines of JSON. The store is `chronicle.db` in the Chronicle data folder, `~/Library/Application Support/Chronicle` on macOS, unless `--db` or `CHRONICLE_DB` names another.

### Patch Changes

- Updated dependencies [f702c6a]
  - @chronicle.app/cql@0.6.0
