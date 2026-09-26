# @chronicle.app/etl-sqlite

## 0.3.0

### Minor Changes

- ea24fda: Add a protected `openDatabase(path)` to `SqliteExtractor` so subclasses can read a copy of a locked database or a database from a backup, `isSqliteBusy(err)` to recognize SQLITE_BUSY errors, and typed `allRows`, `getRow` and `iterateRows` statement helpers. The README now lists the `node:sqlite` differences that break code ported from better-sqlite3.

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
