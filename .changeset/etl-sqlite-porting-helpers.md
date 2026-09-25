---
'@chronicle.app/etl-sqlite': minor
---

Add a protected `openDatabase(path)` to `SqliteExtractor` so subclasses can read a copy of a locked database or a database from a backup, `isSqliteBusy(err)` to recognize SQLITE_BUSY errors, and typed `allRows`, `getRow` and `iterateRows` statement helpers. The README now lists the `node:sqlite` differences that break code ported from better-sqlite3.
