# @chronicle.app/etl-sqlite

SQLite extraction with built-in `node:sqlite` on Node >=22.13.0.

Extend `SqliteExtractor`, declare `source` and `strategy`, and implement `extract()` using the protected `db` connection. Pass an existing database path as `input`. Always call `teardown()` in a `finally` block, including after setup or extraction fails.

`setup()` opens `input` with the protected `openDatabase(path)`. Call it from a subclass to read a different file, such as a temporary copy of a database the source app keeps exclusively locked, or a database extracted from a backup. Close and clear `this.db` before reopening; `teardown()` closes whichever connection is open.

```ts
override async setup(): Promise<void> {
  await super.setup();
  try {
    this.db!.prepare('SELECT 1 FROM sqlite_schema').get();
  } catch (err) {
    if (!isSqliteBusy(err)) throw err;
    this.db!.close();
    this.db = null;
    const copy = join(await mkdtemp(join(tmpdir(), 'source-')), 'copy.sqlite');
    await copyFile(this.config.input, copy);
    this.db = this.openDatabase(copy);
  }
}
```

`isSqliteBusy(err)` reports whether an error is SQLITE_BUSY (including extended busy codes). Opening a locked database succeeds; the first read fails.

`allRows<T>(stmt, ...params)`, `getRow<T>(stmt, ...params)` and `iterateRows<T>(stmt, ...params)` wrap `all()`, `get()` and `iterate()` with a row type, so call sites need no `as unknown as T[]`. The type is not checked at runtime.

The connection is read-only: missing databases are not created, and journal mode is not changed. Live WAL databases require access to the database and its sidecar files; a copied database must include uncheckpointed WAL contents or be a consistent SQLite backup.

`timeRangeConditions(column, range, options)` returns parameterized SQL conditions and values. The column is a trusted developer-supplied SQL identifier, not user input. Bounds are exclusive by default; conversion functions and inclusive operators are supported. Numeric dates are Unix milliseconds; the default SQL values are Unix seconds.

Apple epoch helpers retain the existing API: iOS inputs/outputs use nanoseconds since 2001, Safari inputs/outputs use seconds since 2001. `iosToUnixTimestamp` returns Unix milliseconds; other Unix arguments/results use seconds.

Node SQLite returns large INTEGER values only when `statement.setReadBigInts(true)` is enabled. Use that for source nanosecond timestamps and convert deliberately at the application boundary.

## Porting from better-sqlite3

`node:sqlite` differs from better-sqlite3 in ways that fail at runtime rather than at compile time. All of these hold on Node 22.13.0:

- Parameters are spread, not passed as an array: `stmt.all(...values)`. `stmt.all(values)` throws `Unknown named parameter '0'`.
- Booleans can't be bound (`ERR_INVALID_ARG_TYPE`). Bind `1` or `0`.
- Reading an integer beyond `Number.MAX_SAFE_INTEGER` throws `ERR_OUT_OF_RANGE`. Call `stmt.setReadBigInts(true)`, or select the column with `CAST(column AS TEXT)`.
- BLOBs come back as `Uint8Array`, not `Buffer`; `Buffer.isBuffer()` is false. Wrap with `Buffer.from(value.buffer, value.byteOffset, value.byteLength)` where a `Buffer` is needed.
- Databases open read-only and their journal mode is never changed. Don't set `journal_mode` or other writing pragmas on source databases.

There is no query builder. Write SQL with `?` placeholders, and build `IN (...)` lists and optional `WHERE` clauses from arrays of conditions and values, as `timeRangeConditions` does.
