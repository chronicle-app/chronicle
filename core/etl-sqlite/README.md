# @chronicle.app/etl-sqlite

SQLite extraction with built-in `node:sqlite` on Node >=22.13.0.

Extend `SqliteExtractor`, declare `source` and `strategy`, and implement `extract()` using the protected `db` connection. Pass an existing database path as `input`. Always call `teardown()` in a `finally` block, including after setup or extraction fails.

The connection is read-only: missing databases are not created, and journal mode is not changed. Live WAL databases require access to the database and its sidecar files; a copied database must include uncheckpointed WAL contents or be a consistent SQLite backup.

`timeRangeConditions(column, range, options)` returns parameterized SQL conditions and values. The column is a trusted developer-supplied SQL identifier, not user input. Bounds are exclusive by default; conversion functions and inclusive operators are supported. Numeric dates are Unix milliseconds; the default SQL values are Unix seconds.

Apple epoch helpers retain the existing API: iOS inputs/outputs use nanoseconds since 2001, Safari inputs/outputs use seconds since 2001. `iosToUnixTimestamp` returns Unix milliseconds; other Unix arguments/results use seconds.

Node SQLite returns large INTEGER values only when `statement.setReadBigInts(true)` is enabled. Use that for source nanosecond timestamps and convert deliberately at the application boundary.
