# @chronicle.app/etl

## 0.5.0

### Minor Changes

- 8c47a8f: Add the Apple Wallet plugin, run as `chronicle extract apple-wallet`. It extracts the card transactions in Wallet on a Mac, which a card's issuer sends soon after each purchase, with the time to the second, whether the card was used with Apple Pay, in person, or online. Wallet keeps only the ten most recent transactions on each card, so run it often; the archive keeps the rest. Each transaction is a `PayAction`, with you as its `agent` and the card as its `instrument`. Its `result` is the `FinancialTransaction`, keyed by Wallet's ID for it, and the action is keyed by its transaction. The transaction carries the `amount`, a `MonetaryAmount`, and the merchant as its `recipient`, an `Agent` keyed by the name the issuer sends. The card is a `PaymentCard` keyed by the card network's identifier for it, named as its issuer shows it, with its last digits as its `alternateName` and its kind as its `category`. The `FinancialAccount` the card is `inAccount` is keyed by the issuer's identifier for the account when the issuer gives one, which outlives the card number, and otherwise by the card the payment used; it is named after the issuer, as a chart of accounts names it, and is a `liability` for a credit card and an `asset` for a debit or prepaid one. Each transaction carries that account's side as one `FinancialPosting` under `hasPart`, keyed by the transaction and the account, negative for a purchase. Where the transaction happened is its `location` when Wallet knows. Each run is a snapshot, since an issuer can update a transaction after sending it.

  The vocabulary adds `TradeAction` and its kind `PayAction`; the `FinancialTransaction` that moving money produces, with its `amount`; the `FinancialPosting` that is one account's side of it, with its signed `amount`; `MonetaryAmount`, a sum of money with its `value` and `currency`, which every `amount` is; the `FinancialAccount` that money is counted in, with its `financialAccountType`; and the `PaymentCard` that payments draw on. `recipient` applies to a `FinancialTransaction`, and `inAccount` can name a `FinancialAccount`. A property can now name its inverse with `inverseName`: `isPartOf` names `hasPart`, a record can give the relation under either name, the generated types accept the inverse on the forward property's range, and `INVERSE_PROPERTIES` maps each inverse name to the forward property a store keeps.

  `@chronicle.app/etl` adds `reference(node)`: a node's identity alone, its `@type`, `@key`, and the fields its key names, for a node that appears again in one payload. A plugin's `SHAPES.md` leaves out `@asserts`, the completeness marker a snapshot source puts on every node, as it already leaves out `@assertedAt`.

- d8569f2: `ArchiveExtractor` opens `--input` with `openExport`, so the Facebook, Instagram, and LinkedIn readers take their export as the zip the service hands over, or unzipped as before, and read it in place. A subclass reads files by their paths in the export. Each declares its export's layout, so `chronicle scan <path>` finds it. `ExportFiles` lists a folder's names with `children(folder)` and gives a reader outside the export a file on disk with `localPath(path)`, a copy out of a zip that lasts until the export is closed, so Instagram's posts and stories keep their media from a zip. `openExport` takes what to call the export in its messages, like `LinkedIn export`.
- b13a24c: Add `openExport`, which opens an export however it was handed over: a folder, a zip, a folder that holds only zips, or one part of a Google Takeout split into numbered zips (`takeout-…-001.zip`, `-002.zip`, …), which brings in its sibling parts as one export. It lists, finds, and streams files by their paths inside the export. Files in a zip are read in place and decompressed as they stream, so a zip of any size is never unpacked to disk. `writeZip` writes a zip for test fixtures.
- fd925c7: An extractor can say which of its kinds a run's options ask for, with a static `kindsFor(config)`. A run that names no kinds reads those, before the plugin's defaults or asking which. When the kinds a run names leave some of them out, the run says so. Apple Health uses it, so `chronicle extract apple-health --series RestingHeartRate` reads `heart` without naming it.
- c37d872: `chronicle scan <path>` looks through a folder or zip for the exports in it, and says for each which source reads it, where it starts, and the command that extracts it. It walks a folder of exports, opens each zip it finds by its index alone, reads a split Takeout's parts as one, and doesn't go into hidden folders, macOS bundles like a photo library, or links. It names the folders and zips at the top that hold no export, and any zip that won't open. Given a file or folder inside an export, like its `export.xml`, it finds that export. `chronicle survey <path>` counts what each export a scan of the path finds holds. A word with a `/`, a leading `~` or `.`, or a `.zip` is a path; any other is a source.

  A plugin's manifest says what each export strategy's exports look like from inside, as `layouts` under the strategy: paths from the folder the export starts at, with `*` and `{option}` as in `locations`, and `"supported": false` for a layout the plugin recognizes but can't read. Matching them takes no plugin code, so an export is found before its plugin is installed. `@chronicle.app/etl` adds `findExports`, to find the exports in a folder or zip, and `findExportsIn`, to find them in a list of paths like a package's manifest. `openExport` opens a folder in a zip by a path through it, like `export.zip/apple_health_export`. Apple Health declares its export's layout.

- 67d3035: `chronicle scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

  A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.

- 266f585: `chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle scan` finds ready, all at once, and fills in a table as each answers, with where each count comes from. A source that isn't ready is listed with what's in its way, and what to do about it. One read online is listed as not surveyable, with the command that extracts it, and so, in a survey of a folder, a zip, or one source, is one that can't say how much it holds. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

  An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.

- 3d7e290: YouTube's Takeout reader takes the Takeout itself, as a folder, a zip, or one part of a split Takeout, as well as its "YouTube and YouTube Music" folder, and reads a zip in place. Its manifest declares the Takeout's layout, so `chronicle scan <path>` finds one however it's kept, and a Takeout with its history in JSON shows as a layout it can't read yet. `ExportFiles` says when each file was last changed with `modified(path)`, in a zip from its index, so a zipped Takeout has the same as-of time as the unzipped one. `writeZip` dates a fixture's entries with `modified`.

### Patch Changes

- c6fe083: `chronicle setup full-disk-access` says whether your terminal has Full Disk Access, and if not, walks through turning it on: it offers to open the list in System Settings, and shows the app in Finder to drag into it. When macOS blocks a file, or `chronicle scan` finds sources or folders macOS blocks, the hint says to run it, and names the app that needs access, like Ghostty, iTerm, or Visual Studio Code, when the shell runs in one of the common terminals and editors. `chronicle setup` holds the commands that set up this computer for the sources that need it.
- b112f78: An iMessage `MessageAction` has its `Message` as its `result`, not its `object`, since sending a message brings it into being, as a call's session is its `CallAction`'s `result`. The vocabulary's `MessageAction` says so, and its examples and the schema site's guides show it.

  iMessage records are events, so a later run adds to what an earlier one stated and doesn't replace it. A store that kept iMessage records from an earlier release has each message as its action's `object` and its `result` once iMessage runs again. Drop those records and extract iMessage again to keep only the `result`.

  A run's progress line names an action by its `result` when it has no `object`, so an iMessage run shows each message's text rather than `MessageAction`, and a Photos run each photo's title or file name.

- bcf39e3: A plugin's SHAPES.md lists each node's whole key, `@type` and `source` too, so a key that leaves one out shows it: one without `source` is shared across sources, and one without `@type` keeps its identity when its type changes. It no longer writes `any source`.
- Updated dependencies [d69e45f]
- Updated dependencies [15228bd]
- Updated dependencies [da123cb]
- Updated dependencies [679e9c8]
- Updated dependencies [eea5dd3]
- Updated dependencies [8c47a8f]
- Updated dependencies [93266b0]
- Updated dependencies [b112f78]
- Updated dependencies [a2160b5]
  - @chronicle.app/schema@0.5.0
  - @chronicle.app/logging@0.5.0

## 0.4.0

### Minor Changes

- b0982a5: Add the Chrome plugin. It reads browsing history from a Chrome profile's `History` database, including visits synced from other devices, and emits a `ViewAction` for each page visit. The agent is the profile's Google account, by its email address, as Gmail and Google Calendar know you. A visit reached by following a link or submitting a form also becomes a `NavigateAction` from the page it came from to the page it landed on, and that page `references` the link followed. The vocabulary adds `MoveAction` and `NavigateAction`. `@chronicle.app/etl-sqlite` adds `chromeToUnixMsSql` and `unixMsToChromeTimestamp` for Chromium's microseconds since 1601. `renderShapes` shows each further action a record becomes as its own node.
- 9358671: Redesign extraction output. A run shows a live line on stderr (spinner, bar, count, rate, clock, and the record in hand) and ends with a one-line summary, with a hint when the default `--limit` cut it short. The CSV and table loaders show readable columns: no JSON-LD bookkeeping, nested nodes as their labels, lists joined, and every record's columns. The table fits the terminal, moves constant columns into a caption, and prints a single record as a card. `--columns schema` keeps every Chronicle schema property as its own dotted column instead. After CSV or table output, stderr hints at the columns the table had no room for and at `--columns schema` when it would show more.
- 2a31cd3: JSON output is more compact. Arrays and objects that fit within 100 columns stay on one line, and long lists of plain values, such as `@key` paths, fill each line instead of taking one line per item. Each record still opens on its own lines and parses to the same value. `formatJson` gives the same layout without color.
- 2148753: Report extraction through output events. Everything a run says on stderr (progress, notices, record errors, the summary, and hints) is now an event rendered by one of three sinks, chosen with `--log-format pretty|plain|json`: pretty on a terminal, plain lines stamped with the time otherwise, and JSON lines for supervisors, with personal fields redacted. A flood of the same record error shows three examples and a count. Plugin warnings now print when stdout is piped instead of being silenced. `@chronicle.app/logging` loggers emit events to a sink the host hands over (`Runner` takes `sink` and `run`), no longer set chalk's global color level, and drop the `theme` option. `TableLoader` moves from `@chronicle.app/etl` into the CLI; etl now exports `Rows`, `columnsOption`, and `LABELS`. Nothing in Chronicle writes to the console any more: every message goes through a logger, a host can redirect all of them with `setDefaultSink`, and during a run anything a plugin or dependency writes to the console becomes its diagnostics on the run's sink instead of reaching stdout. Without a known total, the live line shows a spinner and a count instead of a bar. Repeated messages no longer flood stderr: messages that repeat (by key, or by scope and message with numbers ignored) show three examples, then a roll-up at most every five seconds with a count and how often each field value came up. `--delay <ms>` now waits before each extracted record rather than each transform, so it slows the whole run, including the read in a buffered run. `chronicle extract help [source]` shows the command's or a source's help, `chronicle extract --help` points to per-source help, and `--list-types` now lists just the record kinds and the strategies that carry them, one per line. When records print to the terminal, the live line still shows while the run starts and reads, and steps aside before the first record. The summary adds how many payloads were written when that differs from the records read, less skipped ones, and at narrow widths drops the destination, written, skipped, and time before cutting counts, never the failure count. Roll-ups print on schedule even when a group goes quiet, and the live line shows `writing <file>` while buffered output flushes. The Are.na, Bluesky, and Google Reader transformers no longer log twice per record. The default `--limit` hint now reads `first 100 · use --limit 0 for all`, adds `of N` when the source reports its size, and appears only when the limit actually left records unread: the runner reads one record past the default limit to know (`Runner` `peek` option and `truncated`). With `--stream` and a known size, the bar measures against the limit rather than the whole source.
- 3b3a921: A `body` or `description` is plain text or Markdown, never HTML. `tidyText` cleans text a source wrote for a screen: it removes padding characters and takes tracking parameters off links, and with `dropLongUrls` (for bulk mail) drops click-tracking redirect URLs while keeping the link's words. `sampleTransform` fails a plugin's SHAPES test when a `body` or `description` holds HTML; a plugin whose text is code passes `allowMarkup`.
- 32d4b05: Record kinds can follow the source (`chronicle extract github stars gists`), and kinds read by separate extractors now run together instead of failing as ambiguous: newest first when each extractor implements the new `occurredAt(record)` hook, one after another otherwise. `-t all` reads every kind, `-t defaults` the plugin's defaults. A plugin that declares no default kinds gets a picker on a bare run (space selects, enter starts, `a` all, `d` defaults), and outside a terminal an error saying how to name kinds; GitHub declares none. A run of several kinds says which it reads, and which it leaves out. The run summary puts the outcome on one line and a line per kind under it.
- e6a3487: The `Runner` reports its own run: `progress` as it reads, processes, and writes records, a keyed `error` event for each failed record operation, and a `summary` with the run's totals once a completed run is torn down. A host that drives the `Runner` directly, such as a server running ETL, gets the same events the CLI shows without re-implementing the counting. `runner.stats` holds the totals, `title` and `output` label the run, `Extractor.recordLimit()` exposes an extractor's limit, and `@chronicle.app/logging` exports the `ProgressFields` and `SummaryFields` shapes. The CLI's output is unchanged.
- 8bfee48: `sampleTransform`, `shapesOf`, and `renderShapes` sketch what a plugin's transformer makes of its records: for each record type, a tree of the nodes it becomes, with each node's key and properties, marking the ones that are sometimes absent, lists, or computed in the transformer rather than copied from the record. The GitHub and Hacker News plugins keep the sketch in a generated `SHAPES.md`, checked by a test and rewritten with `npm run shapes`.
- a393051: A Shazam plugin extracts the songs you identified with Shazam from the library macOS keeps for Music Recognition, which syncs with the Shazam library in your iCloud account. Each Shazam is a `ListenAction` of the song, with where you were when the device knew. A song is Shazam's copy, keyed by its Shazam track key and named as Shazam names it, and `sameAs` its ISRC and its Apple Music song. `--link-artists` looks up each song's main artist on Apple Music and keys the artist by its Apple Music ID. `@chronicle.app/etl` adds `normalizeIsrc`, which writes an ISRC in its canonical form, and `ISRC_SOURCE`, the namespace a recording is `sameAs` by its ISRC.
- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.

### Patch Changes

- b567d4e: `DateTime` is now the one datatype for a point in time, and `Date` is gone. A `DateTime` is a JavaScript `Date` or an EDTF string at the precision the source knows: a UTC instant (`2024-03-02T14:05:00Z`), a year, month, or day (`1987`, `1987-06`, `1987-06-12`), unspecified digits (`198X`, `XXXX-03-12`), and an uncertain or approximate date (`1987?`, `1950~`). Strings are checked rather than accepted as they are, and `isDateTime` checks one. `@assertedAt` must be an instant, which `isInstant` checks, so an event dated only partly is no longer asserted at that date. FoodNoms timestamps are now instants rather than strings with a space before the time.
- Updated dependencies [b0982a5]
- Updated dependencies [ac25170]
- Updated dependencies [f0a3390]
- Updated dependencies [b567d4e]
- Updated dependencies [61ad43e]
- Updated dependencies [ee0525c]
- Updated dependencies [3b3a921]
- Updated dependencies [3b3a921]
- Updated dependencies [c7d87c5]
- Updated dependencies [2148753]
- Updated dependencies [04cce7e]
- Updated dependencies [3b3a921]
- Updated dependencies [e6a3487]
- Updated dependencies [59904c0]
- Updated dependencies [243db5a]
  - @chronicle.app/schema@0.4.0
  - @chronicle.app/logging@0.4.0

## 0.3.0

### Minor Changes

- d5f2f96: `ChronicleTransformer` stamps `@assertedAt` on each payload that doesn't set one: an event at its own `timestamp`, `startTime`, or `endTime` (none without one), and a snapshot at the extraction's read time. `Base` declares `@assertedAt` as a date or string.
- 983fa92: Add the helpers that API sources use: `ApiProxy`, a base class for a source's HTTP client that maps 401 and 429 responses to `ApiAuthError` and `ApiRateLimitError`, and the `paginateOffset`, `paginateByPage`, and `paginateCursor` strategies. Add `htmlToText`, `htmlToMarkdown`, `decodeEntities`, `looksLikeHtml`, and `tokenizeHtml` for sources that store HTML as content.
- cac20e0: Add `ArchiveExtractor`, a base for takeout-style exports read in place; `MergingExtractor`, which merges several newest-first child extractors into one newest-first stream under a single limit; and `SystemInfo`, which reads the user's name, hostname, and platform identifier on macOS, Linux, and Windows.
- 350ec02: Declare `keyOf`, `newestFirst` and `frontierThreshold` on `Extractor` so plugins can state their source identity and ordering ahead of an incremental-import cursor. Nothing reads them yet; extraction is unchanged.
- f400092: `chronicle plugins new <name>` creates a plugin of your own and adds it. It asks how the data reaches you (a CSV or JSON file, an export folder, an app's SQLite database, a web API, or something else) and starts the extractor on the matching base class. The plugin has an empty transformer, the `chronicle` manifest, a smoke test, a README, and an `AGENTS.md` that lists what to fill in next for that kind of source, for you or a coding agent. `--from` answers the question without a terminal. The TypeScript runs without a build, and its tsconfig allows only syntax Node can strip. `chronicle extract <source> --preview` prints the first five records as readable text. On Node.js 22.13 to 22.17, the CLI relaunches itself once with type stripping when a TypeScript plugin may run. The CLI shares `@chronicle.app/etl-sqlite` with plugins alongside `etl`, `schema`, and `auth`, and `@chronicle.app/etl` exports `z`, so a plugin can extend `Extractor.schema` without its own copy of zod.
- acb79bc: Extractors can pass `createRecord(data, context, { assertedAt })` when they know when the source observed a record, such as an API's per-item fetch time. It is kept as `extraction.recordAssertedAt` and becomes the payload's `@assertedAt` ahead of the event and snapshot defaults, unless the payload sets its own.
- 78086b7: `ChronicleTransformer` marks every node of a snapshot source's payload `@asserts: ['*']`, a complete read of its current values, so values that have since gone away can be closed. `Base` declares `@asserts`. Things tasks now carry the marker. Payloads are labelled by source, type, and their end, start, or event time instead of their `sourceId`.
- 0f72f02: `selfAgent()` now returns the schema node for its `type`: a `Person` by default, an `Agent` for `type: 'Agent'`. `type` is limited to `Agent` and its subtypes, and `sameAs` takes schema entities or strings. `buildICloudPersonSchema()` returns `Promise<Person>`, never null, and takes lookup options. With no readable iCloud account it returns the `@me` fallback Person keyed by `['@type', 'source']`. `@chronicle.app/icloud` now has `@chronicle.app/schema` as a peer dependency.

### Patch Changes

- Updated dependencies [d8d36ef]
- Updated dependencies [3431450]
- Updated dependencies [65ddcca]
- Updated dependencies [80598fa]
- Updated dependencies [5c96cd7]
- Updated dependencies [93a5216]
- Updated dependencies [8ae2741]
- Updated dependencies [28a429d]
- Updated dependencies [9bed946]
- Updated dependencies [fe75616]
- Updated dependencies [d6b5830]
- Updated dependencies [350ec02]
- Updated dependencies [86968a9]
- Updated dependencies [92674c9]
- Updated dependencies [9b56efb]
- Updated dependencies [d5f2f96]
- Updated dependencies [17f4d09]
- Updated dependencies [b9ee0b1]
- Updated dependencies [d5f2f96]
- Updated dependencies [acb79bc]
- Updated dependencies [78086b7]
  - @chronicle.app/schema@0.3.0
  - @chronicle.app/logging@0.3.0

## 0.2.0

### Patch Changes

- d71b202: Upgrade `csv-parse` to 7, which fixes a prototype-replacement advisory in the `columns` option (GHSA-8cw4-87c7-c6xx), and the CLI's `glob` to 13, replacing a deprecated release.
- Updated dependencies [63bbde7]
  - @chronicle.app/schema@0.2.0
  - @chronicle.app/logging@0.2.0
