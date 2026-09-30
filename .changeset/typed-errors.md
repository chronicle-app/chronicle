---
'@chronicle.app/logging': minor
'@chronicle.app/etl': minor
'@chronicle.app/etl-sqlite': patch
'@chronicle.app/auth': patch
'@chronicle.app/cli': minor
'@chronicle.app/shell': patch
'@chronicle.app/linkedin': patch
'@chronicle.app/lastfm': patch
'@chronicle.app/spotify': patch
'@chronicle.app/youtube': patch
'@chronicle.app/zotero': patch
'@chronicle.app/imessage': patch
'@chronicle.app/things-todo': patch
---

Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.
