# @chronicle.app/cli

## 0.4.0

### Minor Changes

- 9358671: Redesign extraction output. A run shows a live line on stderr (spinner, bar, count, rate, clock, and the record in hand) and ends with a one-line summary, with a hint when the default `--limit` cut it short. The CSV and table loaders show readable columns: no JSON-LD bookkeeping, nested nodes as their labels, lists joined, and every record's columns. The table fits the terminal, moves constant columns into a caption, and prints a single record as a card. `--columns schema` keeps every Chronicle schema property as its own dotted column instead. After CSV or table output, stderr hints at the columns the table had no room for and at `--columns schema` when it would show more.
- 3b3a921: A `guide` event is a section of a walkthrough a person follows along with: a title, a few plain sentences, and numbered steps, printed in full after a blank line instead of as muted hints. `chronicle auth login` asks before opening each page in the browser.
- 3b3a921: OAuth sign-in keeps one entry per account, and a token refresh updates the entry it read, where it used to overwrite the first one stored. Signing in again replaces your entry instead of adding another. Refresh uses the token URL saved at sign-in. `chronicle auth login` sends a `state` (and a PKCE challenge, for providers that use one) and checks the reply, no longer prints the tokens, takes `--client-file` and `--add`, and runs a provider's guided setup when it has one. `chronicle auth status` lists every signed-in account. A command that fails with a typed error keeps its exit code. Pressing Enter opens each page in the browser; a sign-in finished by hand doesn't wait for it. `--scopes` and `--add` can't be combined. `auth status` shows each account's expiry without refreshing it.
- 2148753: Report extraction through output events. Everything a run says on stderr (progress, notices, record errors, the summary, and hints) is now an event rendered by one of three sinks, chosen with `--log-format pretty|plain|json`: pretty on a terminal, plain lines stamped with the time otherwise, and JSON lines for supervisors, with personal fields redacted. A flood of the same record error shows three examples and a count. Plugin warnings now print when stdout is piped instead of being silenced. `@chronicle.app/logging` loggers emit events to a sink the host hands over (`Runner` takes `sink` and `run`), no longer set chalk's global color level, and drop the `theme` option. `TableLoader` moves from `@chronicle.app/etl` into the CLI; etl now exports `Rows`, `columnsOption`, and `LABELS`. Nothing in Chronicle writes to the console any more: every message goes through a logger, a host can redirect all of them with `setDefaultSink`, and during a run anything a plugin or dependency writes to the console becomes its diagnostics on the run's sink instead of reaching stdout. Without a known total, the live line shows a spinner and a count instead of a bar. Repeated messages no longer flood stderr: messages that repeat (by key, or by scope and message with numbers ignored) show three examples, then a roll-up at most every five seconds with a count and how often each field value came up. `--delay <ms>` now waits before each extracted record rather than each transform, so it slows the whole run, including the read in a buffered run. `chronicle extract help [source]` shows the command's or a source's help, `chronicle extract --help` points to per-source help, and `--list-types` now lists just the record kinds and the strategies that carry them, one per line. When records print to the terminal, the live line still shows while the run starts and reads, and steps aside before the first record. The summary adds how many payloads were written when that differs from the records read, less skipped ones, and at narrow widths drops the destination, written, skipped, and time before cutting counts, never the failure count. Roll-ups print on schedule even when a group goes quiet, and the live line shows `writing <file>` while buffered output flushes. The Are.na, Bluesky, and Google Reader transformers no longer log twice per record. The default `--limit` hint now reads `first 100 · use --limit 0 for all`, adds `of N` when the source reports its size, and appears only when the limit actually left records unread: the runner reads one record past the default limit to know (`Runner` `peek` option and `truncated`). With `--stream` and a known size, the bar measures against the limit rather than the whole source.
- 32d4b05: Record kinds can follow the source (`chronicle extract github stars gists`), and kinds read by separate extractors now run together instead of failing as ambiguous: newest first when each extractor implements the new `occurredAt(record)` hook, one after another otherwise. `-t all` reads every kind, `-t defaults` the plugin's defaults. A plugin that declares no default kinds gets a picker on a bare run (space selects, enter starts, `a` all, `d` defaults), and outside a terminal an error saying how to name kinds; GitHub declares none. A run of several kinds says which it reads, and which it leaves out. The run summary puts the outcome on one line and a line per kind under it.
- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.

### Patch Changes

- cde93d3: `chronicle plugins` labels the core plugins `bundled` when the CLI runs through npx or a flat install, where npm puts them beside the CLI, instead of `beside-cli`. A separately installed copy beside the CLI is still labelled `beside-cli` and still takes precedence.
- 7a56e54: Every error reads the same way: `✗ Error: <message>`, with the next step as a `↳` hint below, instead of oclif's `› Error:` with the advice folded into the message. That covers errors commands raise, errors that escape them, and oclif's own parse errors, whose "See more help" points at the command's (or the source's) `--help`. A flag value an extractor's schema rejects reads as `--since: Invalid date` rather than a raw schema dump. The `config` commands no longer report their own exits as failures, so `config get` of an unset key exits quietly with code 1. The `Error:` label is red, like the `✗`; the message stays plain.

  A command in a hint prints without its backticks when there's color, plain against the dim hint so it stands out; plain output keeps the backticks. Hints name real examples rather than templates.

  Hints are plain sentences with the command in them ("Run `chronicle auth login lastfm` to sign in."). A command that doesn't exist (`chronicle sorces`) is reported the same way, suggesting the nearest one. `chronicle list`, an alias of `chronicle sources`, is gone.

- 3c62728: `extract <source> --list-types` follows the list with a hint on stderr: how to pick kinds with `--type`, a runnable example, and what a run without `--type` reads. The source help now says the same instead of claiming a bare run reads every kind, which was true only for sources whose one extractor emits them all.
- 3b3a921: `--list-types` on a source with one record type prints just the list, without a hint about picking others.
- cf15766: Stop printing `[DEP0205] DeprecationWarning: module.register() is deprecated` on Node 26. The CLI now shares its packages with plugins through `module.registerHooks()` where Node has it (22.15+), falling back to `module.register()` on older Node 22. `@chronicle.app/logging` is now shared with plugins too, so a plugin that imports it directly follows the CLI's output.
- e6a3487: The `Runner` reports its own run: `progress` as it reads, processes, and writes records, a keyed `error` event for each failed record operation, and a `summary` with the run's totals once a completed run is torn down. A host that drives the `Runner` directly, such as a server running ETL, gets the same events the CLI shows without re-implementing the counting. `runner.stats` holds the totals, `title` and `output` label the run, `Extractor.recordLimit()` exposes an extractor's limit, and `@chronicle.app/logging` exports the `ProgressFields` and `SummaryFields` shapes. The CLI's output is unchanged.
- 77507b0: An unknown `--type` is now a short usage error (exit code 2) with a hint that lists the source's kinds, and suggests the closest one when it's a near miss, instead of the source's whole help.

  The `--list-types` hint suggests a single kind, since kinds read by separate extractors can't run together.

  A flag a source doesn't have is a usage error too, suggesting the likeliest flag (`-T` → `-t` / `--type`) and pointing at the source's `--help` and `--list-types`, instead of the generic `extract` usage that lists none of the source's flags. A source's `--help` lists `--type` and `--list-types` with the other common flags.

  `--type` with no value says where to find the kinds: `chronicle extract <source> --list-types`.

- Updated dependencies [b0982a5]
- Updated dependencies [9358671]
- Updated dependencies [2a31cd3]
- Updated dependencies [a7fb44c]
- Updated dependencies [b567d4e]
- Updated dependencies [61ad43e]
- Updated dependencies [ee0525c]
- Updated dependencies [3b3a921]
- Updated dependencies [3b3a921]
- Updated dependencies [3b3a921]
- Updated dependencies [2148753]
- Updated dependencies [3b3a921]
- Updated dependencies [32d4b05]
- Updated dependencies [e6a3487]
- Updated dependencies [8bfee48]
- Updated dependencies [a393051]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/schema@0.4.0
  - @chronicle.app/etl@0.4.0
  - @chronicle.app/auth@0.4.0
  - @chronicle.app/logging@0.4.0
  - @chronicle.app/imessage@0.4.0
  - @chronicle.app/shell@0.4.0
  - @chronicle.app/things-todo@0.4.0
  - @chronicle.app/safari@0.4.0
  - @chronicle.app/claude-code@0.4.0

## 0.3.0

### Minor Changes

- d8d36ef: Add the Arc Timeline plugin, bundled with the CLI. It reads Arc Timeline's daily iCloud backup and emits a `VisitAction` for each stay and a `TravelAction` with a `Journey` for each trip. The vocabulary adds `VisitAction`, `TravelAction`, `Journey`, `Place`, `Venue`, the `Location` structured value, and `Number`, with `startTime`, `endTime`, `result`, `location`, `latitude`, `longitude`, `address`, `category`, `travelMode`, `distance`, and `path`.
- 3431450: Add the Are.na plugin, bundled with the CLI. It reads your channels, blocks, connections, comments, and follows through the Are.na API. The vocabulary adds `caption` for image alt text.
- 429c846: Add the Bluesky plugin, bundled with the CLI. It reads your follows, followers, and likes through the atproto API and emits `FollowAction`, `LikeAction`, and `PublishAction`.
- 65ddcca: Add the Call History plugin, bundled with the CLI. It reads phone and FaceTime calls from the macOS Call History database and emits a `CallAction` whose result is a `CallSession` for each call. The vocabulary adds `InteractAction`, `CommunicateAction`, `CallAction`, `Session`, and `CallSession`, and `recipient` applies to `CallSession`.
- bc6dabb: Add the email plugin, bundled with the CLI. It reads messages from an mbox file and emits a `MessageAction` for each message, keyed on its Message-ID, or on its sender, date, and subject when it has none.
- 80598fa: Add the Facebook plugin, bundled with the CLI. It reads a Facebook data export and emits a `MessageAction` for each Messenger message, a `FindAction` with a `Query` for each search, a `LikeAction` for each like, and a `RespondAction` for each reaction or comment. The vocabulary adds `FindAction`, `Query`, `AssessAction`, `ReactAction`, `LikeAction`, `RespondAction`, `Post`, `Response`, and `Comment`, and `author` now applies to any `CreativeWork`.
- 5c96cd7: Add the FoodNoms plugin, bundled with the CLI. It reads meal logs from the FoodNoms database and emits an `EatAction` or `DrankAction` for each food entry. The vocabulary adds `EatAction`, `DrankAction`, and `Meal`.
- 93a5216: Add the Foursquare plugin, which reads Foursquare/Swarm check-ins through the Foursquare API and emits them as check-ins at venues. The schema gains `CheckInAction`.
- 8ae2741: Add the Goodreads plugin, bundled with the CLI. It reads a Goodreads library export CSV and emits a `BookmarkAction`, `CompleteAction`, or `ConsumeAction` on a `Book` for each shelved book. The vocabulary adds `Book`, `pageCount`, `publisher`, and `creator`.
- 38554eb: Add the Google Reader plugin, bundled with the CLI. It reads an unpacked Google Reader archive and emits a `ReadAction`, `PublishAction`, or `LikeAction` for each item you read, shared, or starred, and an `AnnotateAction` with a `Comment` for each of your notes.
- 28a429d: Add the Instagram plugin, bundled with the CLI. It reads an Instagram data export and emits your posts, stories, direct messages, likes, follows, saves, comments and searches. The vocabulary adds `Post`, `PublishAction`, `LikeAction`, `FollowAction`, `BookmarkAction`, `CreateAction`, `FindAction`, `RespondAction`, `Comment`, `Query`, `Response`, `sourceFormat`, `visibility`, `references`, and `target`.
- 4bf4f8c: Add the Last.fm plugin, bundled with the CLI. It reads listens, loved tracks, and friends from the Last.fm API and emits `ListenAction`, `LikeAction`, `FollowAction`, and `CreateAction` records, and registers a `lastfm` provider for `chronicle auth login`.
- 9bed946: Add the LinkedIn plugin, which reads an unpacked LinkedIn data export: messages, connections, endorsements, company follows, positions, education, Learning courses, and the profile. The schema gains the terms it emits, such as `JoinAction`, `LeaveAction`, `Tenure`, `Enrollment`, `FollowAction`, `RespondAction`, `WatchAction`, and `BookmarkAction`, and an action's `timestamp` may now be a civil date.
- fe75616: Add the Marvin plugin, bundled with the CLI. It reads Marvin's CSV exports and emits a `ReadAction` for each reading session and a `QuoteAction` or `AnnotateAction` for each highlight or note. The vocabulary adds `ReadAction`, `QuoteAction`, and `Quotation`.
- 4a9cb93: Add the Moves plugin, bundled with the CLI. It reads the JSON storyline in a Moves data export and emits a `VisitAction` for each stay and a `TravelAction` with a `Journey` for each leg of movement.
- d6b5830: Add the Obsidian plugin, bundled with the CLI. It reads the Markdown notes in a vault and emits an `UpdateAction` for each note's `DocumentObject`, with its tags and the notes and web pages it links to. The vocabulary adds `tags`.
- f7af269: Add the Pinboard plugin, which reads bookmarks from the Pinboard API as `BookmarkAction`s.
- 350ec02: Add the Safari plugin, bundled with the CLI. It reads browsing history from Safari's `History.db` and emits a `ViewAction` for each page visit. The vocabulary adds `ViewAction`.
- 6dcc980: Add the Slack plugin, which reads messages, authors, recipients, and file attachments from a slackdump export.
- 86968a9: Add the Spotify plugin, bundled with the CLI. It reads recently played tracks, saved tracks and albums, and playlist entries through the Spotify Web API after `chronicle auth login spotify`, and emits a `ListenAction`, `LikeAction`, or `AddAction` for each. The vocabulary adds `ListenAction`, `LikeAction`, `AddAction`, `ReactAction`, `AssessAction`, `MusicRecording`, `MusicAlbum`, `MusicGroup`, `PerformingGroup`, and `PodcastEpisode`, with `artist`, `inAlbum`, `duration`, `genre`, `datePublished`, `emblem`, `target`, `width`, `height`, `performer`, `attribution`, `partOf`, and `composition`.
- 92674c9: Add the Timing plugin, bundled with the CLI. It reads app usage, logged time entries, and relayed phone calls from Timing's local database and emits `ExecuteAction`, `ExperienceAction`, and `CallAction` records. The vocabulary adds `DeviceSession`, `PhysicalObject`, `Device`, `Directory`, `workingDirectory`, `subject`, and `model`.
- 9b56efb: Add the Twitter plugin, bundled with the CLI. It reads a Twitter/X data archive and emits a `PublishAction` for each tweet, a `LikeAction` for each like, and a `MessageAction` for each direct message. The vocabulary adds `Post`, `PublishAction`, `CreateAction`, `LikeAction`, `ReactAction`, `AssessAction`, `Session`, `references`, and `mentions`, and `author` now applies to any `CreativeWork`.
- d5f2f96: Add the WhatsApp plugin, bundled with the CLI. It reads messages from the macOS WhatsApp database, or from an unencrypted iPhone backup with `--strategy backup`, and emits a `MessageAction` for each message. The vocabulary adds `CreativeWork`, `Channel`, `Organization`, `member`, and `inReplyTo`.
- 17f4d09: Add the YouTube plugin, bundled with the CLI. It reads likes, subscriptions, playlists, and uploads from the YouTube Data API after `chronicle auth login youtube`, or watch and search history, comments, and the library from a Google Takeout folder with `--strategy takeout`. The vocabulary adds `AnnotateAction`, and `MediaObject` and `Collection` now sit under `CreativeWork`.
- b9ee0b1: Add the Zotero plugin, bundled with the CLI. It reads a local Zotero library and emits a `BookmarkAction` for each saved work, a `ViewAction` for each file's last open, and `QuoteAction`s and `AnnotateAction`s for highlights and notes. The vocabulary adds `Article`, the page and EPUB CFI selectors, and the properties they use, and moves `Message` and `SoftwareApplication` under `CreativeWork`.
- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- f400092: `chronicle plugins add <path>` runs a plugin from its folder on your machine (or a single file) without installing it. It loads the plugin once, lists the sources it found, and saves the path to your Chronicle config, so edits apply on the next run. A local plugin takes over any source it provides, including an official one, and each run of that source says so. `chronicle plugins remove <name|path>` stops using it, by name even after its folder is gone, and a plugin whose folder is deleted comes off the list on the next run, and `chronicle plugins` shows local plugins with their paths. TypeScript plugins run directly, without a build.
- f400092: `chronicle plugins new <name>` creates a plugin of your own and adds it. It asks how the data reaches you (a CSV or JSON file, an export folder, an app's SQLite database, a web API, or something else) and starts the extractor on the matching base class. The plugin has an empty transformer, the `chronicle` manifest, a smoke test, a README, and an `AGENTS.md` that lists what to fill in next for that kind of source, for you or a coding agent. `--from` answers the question without a terminal. The TypeScript runs without a build, and its tsconfig allows only syntax Node can strip. `chronicle extract <source> --preview` prints the first five records as readable text. On Node.js 22.13 to 22.17, the CLI relaunches itself once with type stripping when a TypeScript plugin may run. The CLI shares `@chronicle.app/etl-sqlite` with plugins alongside `etl`, `schema`, and `auth`, and `@chronicle.app/etl` exports `z`, so a plugin can extend `Extractor.schema` without its own copy of zod.

### Patch Changes

- 9ed68e6: `chronicle extract whatsapp` reads the Mac's WhatsApp database again instead of treating it as an iPhone backup. An extractor's default `--input` no longer counts as a path you gave, so it doesn't switch a source to its export strategy; only an `--input` you pass does.
- b6a5660: Arc Timeline runs as `chronicle extract arc-timeline` instead of `arc`; its records keep the `arc` namespace. The Call History plugin is now `@chronicle.app/apple-call-history`, run as `chronicle extract apple-call-history` instead of `apple-phone`, and its records (and Timing's relayed calls, which fold with them) use the `apple-call-history` namespace, named for Apple's CallHistory store (`com.apple.CallHistory`), which holds phone and FaceTime calls alike. The `sources` table names the plugin where it matters: the one to install when its name differs from the source's, which local plugin is running a source, and which package outside the catalog provides one.
- 91e6783: `chronicle sources` fits its table to the terminal: narrow columns size to their content and never wrap, and Record Types and Description share the rest of the width, truncating only when they have to. `--format json` includes each extractor's `default`. Facebook defaults to Messenger conversations and Instagram to posts, so `chronicle extract facebook` and `chronicle extract instagram` work without `--type`.
- b1b9cb4: `chronicle extract` reports an unknown source as "No source named …" (or offers to install a catalog source) even when the command includes that source's own flags, such as `--limit`, instead of failing on the flag first.
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
- Updated dependencies [983fa92]
- Updated dependencies [cac20e0]
- Updated dependencies [ea24fda]
- Updated dependencies [350ec02]
- Updated dependencies [fd58a46]
- Updated dependencies [f400092]
- Updated dependencies [f400092]
- Updated dependencies [f400092]
- Updated dependencies [acb79bc]
- Updated dependencies [acb79bc]
- Updated dependencies [651d031]
- Updated dependencies [3f21b60]
- Updated dependencies [78086b7]
- Updated dependencies [0f72f02]
  - @chronicle.app/schema@0.3.0
  - @chronicle.app/safari@0.3.0
  - @chronicle.app/etl@0.3.0
  - @chronicle.app/etl-sqlite@0.3.0
  - @chronicle.app/imessage@0.3.0
  - @chronicle.app/claude-code@0.3.0
  - @chronicle.app/shell@0.3.0
  - @chronicle.app/things-todo@0.3.0
  - @chronicle.app/auth@0.3.0

## 0.2.0

### Patch Changes

- d71b202: Upgrade `csv-parse` to 7, which fixes a prototype-replacement advisory in the `columns` option (GHSA-8cw4-87c7-c6xx), and the CLI's `glob` to 13, replacing a deprecated release.
- Updated dependencies [d71b202]
- Updated dependencies [c097762]
- Updated dependencies [63bbde7]
  - @chronicle.app/etl@0.2.0
  - @chronicle.app/claude-code@0.2.0
  - @chronicle.app/imessage@0.2.0
  - @chronicle.app/shell@0.2.0
  - @chronicle.app/things-todo@0.2.0
  - @chronicle.app/schema@0.2.0
  - @chronicle.app/auth@0.2.0
