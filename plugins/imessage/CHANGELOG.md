# @chronicle.app/imessage

## 0.4.0

### Patch Changes

- 2148753: Report extraction through output events. Everything a run says on stderr (progress, notices, record errors, the summary, and hints) is now an event rendered by one of three sinks, chosen with `--log-format pretty|plain|json`: pretty on a terminal, plain lines stamped with the time otherwise, and JSON lines for supervisors, with personal fields redacted. A flood of the same record error shows three examples and a count. Plugin warnings now print when stdout is piped instead of being silenced. `@chronicle.app/logging` loggers emit events to a sink the host hands over (`Runner` takes `sink` and `run`), no longer set chalk's global color level, and drop the `theme` option. `TableLoader` moves from `@chronicle.app/etl` into the CLI; etl now exports `Rows`, `columnsOption`, and `LABELS`. Nothing in Chronicle writes to the console any more: every message goes through a logger, a host can redirect all of them with `setDefaultSink`, and during a run anything a plugin or dependency writes to the console becomes its diagnostics on the run's sink instead of reaching stdout. Without a known total, the live line shows a spinner and a count instead of a bar. Repeated messages no longer flood stderr: messages that repeat (by key, or by scope and message with numbers ignored) show three examples, then a roll-up at most every five seconds with a count and how often each field value came up. `--delay <ms>` now waits before each extracted record rather than each transform, so it slows the whole run, including the read in a buffered run. `chronicle extract help [source]` shows the command's or a source's help, `chronicle extract --help` points to per-source help, and `--list-types` now lists just the record kinds and the strategies that carry them, one per line. When records print to the terminal, the live line still shows while the run starts and reads, and steps aside before the first record. The summary adds how many payloads were written when that differs from the records read, less skipped ones, and at narrow widths drops the destination, written, skipped, and time before cutting counts, never the failure count. Roll-ups print on schedule even when a group goes quiet, and the live line shows `writing <file>` while buffered output flushes. The Are.na, Bluesky, and Google Reader transformers no longer log twice per record. The default `--limit` hint now reads `first 100 · use --limit 0 for all`, adds `of N` when the source reports its size, and appears only when the limit actually left records unread: the runner reads one record past the default limit to know (`Runner` `peek` option and `truncated`). With `--stream` and a known size, the bar measures against the limit rather than the whole source.
- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/icloud@0.4.0
  - @chronicle.app/etl-sqlite@0.4.0

## 0.3.0

### Minor Changes

- fd58a46: Read the Apple Account from the system Accounts database when MobileMeAccounts is empty, as it is on newer macOS, so the account owner is keyed by their DSID again. `buildICloudPersonSchema` now returns `null` when no account can be read, instead of a Person keyed only by `['@type', 'source']` that every account-less owner shared; Safari and iMessage leave the owner out in that case. iMessage's SMS owner with no identifier is left out the same way.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- Updated dependencies [ea24fda]
- Updated dependencies [fd58a46]
- Updated dependencies [651d031]
- Updated dependencies [0f72f02]
  - @chronicle.app/etl-sqlite@0.3.0
  - @chronicle.app/icloud@0.3.0

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
- Updated dependencies [c097762]
  - @chronicle.app/etl-sqlite@0.2.0
  - @chronicle.app/icloud@0.2.0
