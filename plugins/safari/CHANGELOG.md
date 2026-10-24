# @chronicle.app/safari

## 0.5.0

### Minor Changes

- 2d4162a: Safari reads bookmarks, favorites, and the Reading List, as the `bookmarks` record type, from Safari's `Bookmarks.plist`. `chronicle extract safari` reads them with history, merged newest first; `chronicle extract safari bookmarks` reads them alone. With `--input`, they're read from the `Bookmarks.plist` beside that `History.db`, if there is one, and `--bookmarks-file` reads another. Each is a `BookmarkAction` whose `object` is the page and whose `target` is the `Collection` it's saved to: Favorites, Bookmarks Menu, Reading List, or a folder of your own, inside the folder that holds it. Each is dated by when it was added. Safari records that for every Reading List item, but only for bookmarks it saved recently, so older bookmarks are left out.
- 266f585: `chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle scan` finds ready, all at once, and fills in a table as each answers, with where each count comes from. A source that isn't ready is listed with what's in its way, and what to do about it. One read online is listed as not surveyable, with the command that extracts it, and so, in a survey of a folder, a zip, or one source, is one that can't say how much it holds. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

  An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.

### Patch Changes

- 27ce35d: `@chronicle.app/icloud` is now `@chronicle.app/apple`, since it reads Apple data on a Mac beyond iCloud: the Apple Account signed in, AddressBook contacts, and now binary property lists. Its exports are unchanged, and records still name the Apple Account `icloud`, so every identity stays the same. It adds `parseBinaryPlist` and `Uid`, which read a binary property list such as an NSKeyedArchiver archive; the Shazam plugin, which had its own, now uses them. The plugins that used `@chronicle.app/icloud` depend on `@chronicle.app/apple` instead.
- 67d3035: `chronicle scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

  A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.

- Updated dependencies [27ce35d]
- Updated dependencies [266f585]
  - @chronicle.app/apple@0.5.0
  - @chronicle.app/etl-sqlite@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [b0982a5]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/icloud@0.4.0

## 0.3.0

### Minor Changes

- 350ec02: Add the Safari plugin, bundled with the CLI. It reads browsing history from Safari's `History.db` and emits a `ViewAction` for each page visit. The vocabulary adds `ViewAction`.
- fd58a46: Read the Apple Account from the system Accounts database when MobileMeAccounts is empty, as it is on newer macOS, so the account owner is keyed by their DSID again. `buildICloudPersonSchema` now returns `null` when no account can be read, instead of a Person keyed only by `['@type', 'source']` that every account-less owner shared; Safari and iMessage leave the owner out in that case. iMessage's SMS owner with no identifier is left out the same way.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- 651d031: Fix extractions that could fail partway with "statement has been finalized" on Node 22.13. `iterateRows` now keeps its statement referenced until iteration ends, and every extractor that iterated an inline `db.prepare(sql).iterate()` uses it.
- Updated dependencies [ea24fda]
- Updated dependencies [fd58a46]
- Updated dependencies [651d031]
- Updated dependencies [0f72f02]
  - @chronicle.app/etl-sqlite@0.3.0
  - @chronicle.app/icloud@0.3.0
