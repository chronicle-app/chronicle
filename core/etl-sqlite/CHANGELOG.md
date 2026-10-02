# @chronicle.app/etl-sqlite

## 0.4.0

### Patch Changes

- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.

## 0.3.0

### Minor Changes

- ea24fda: Add a protected `openDatabase(path)` to `SqliteExtractor` so subclasses can read a copy of a locked database or a database from a backup, `isSqliteBusy(err)` to recognize SQLITE_BUSY errors, and typed `allRows`, `getRow` and `iterateRows` statement helpers. The README now lists the `node:sqlite` differences that break code ported from better-sqlite3.

### Patch Changes

- 651d031: Fix extractions that could fail partway with "statement has been finalized" on Node 22.13. `iterateRows` now keeps its statement referenced until iteration ends, and every extractor that iterated an inline `db.prepare(sql).iterate()` uses it.

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
