# @chronicle.app/foodnoms

## 0.5.0

### Minor Changes

- 266f585: `chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle scan` finds ready, all at once, and fills in a table as each answers, with where each count comes from. A source that isn't ready is listed with what's in its way, and what to do about it. One read online is listed as not surveyable, with the command that extracts it, and so, in a survey of a folder, a zip, or one source, is one that can't say how much it holds. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

  An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.

### Patch Changes

- 27ce35d: `@chronicle.app/icloud` is now `@chronicle.app/apple`, since it reads Apple data on a Mac beyond iCloud: the Apple Account signed in, AddressBook contacts, and now binary property lists. Its exports are unchanged, and records still name the Apple Account `icloud`, so every identity stays the same. It adds `parseBinaryPlist` and `Uid`, which read a binary property list such as an NSKeyedArchiver archive; the Shazam plugin, which had its own, now uses them. The plugins that used `@chronicle.app/icloud` depend on `@chronicle.app/apple` instead.
- 0649712: FoodNoms leaves out the foods in a saved recipe or meal, which were never eaten. A food logged to a day without a time is eaten at noon UTC that day, rather than in 1970, and `--since` and `--until` keep it by that day.
- 1d04da0: Apple Podcasts, Voice Memos, Chrome, FoodNoms, Things, and WhatsApp list Full Disk Access among what they need, so `chronicle sources info` says so. On Linux and Windows, `sources info` leaves Full Disk Access out, since only macOS grants it.
- 67d3035: `chronicle scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

  A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.

- Updated dependencies [27ce35d]
- Updated dependencies [266f585]
  - @chronicle.app/apple@0.5.0
  - @chronicle.app/etl-sqlite@0.5.0

## 0.4.0

### Patch Changes

- f0a3390: `DrankAction` is now `DrinkAction`, in the present tense like the other actions and named like schema.org's `DrinkAction`. FoodNoms emits a `DrinkAction` for each drink.
- b567d4e: `DateTime` is now the one datatype for a point in time, and `Date` is gone. A `DateTime` is a JavaScript `Date` or an EDTF string at the precision the source knows: a UTC instant (`2024-03-02T14:05:00Z`), a year, month, or day (`1987`, `1987-06`, `1987-06-12`), unspecified digits (`198X`, `XXXX-03-12`), and an uncertain or approximate date (`1987?`, `1950~`). Strings are checked rather than accepted as they are, and `isDateTime` checks one. `@assertedAt` must be an instant, which `isInstant` checks, so an event dated only partly is no longer asserted at that date. FoodNoms timestamps are now instants rather than strings with a space before the time.
- 7e12eb1: Fix `chronicle extract foodnoms` failing with `ERR_OUT_OF_RANGE` when a meal slot's `sortIndex` is outside JavaScript's safe integer range. FoodNoms can store values near Int64.min there; those now come through as decimal strings.
- Updated dependencies [b0982a5]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/icloud@0.4.0

## 0.3.0

### Minor Changes

- 5c96cd7: Add the FoodNoms plugin, bundled with the CLI. It reads meal logs from the FoodNoms database and emits an `EatAction` or `DrankAction` for each food entry. The vocabulary adds `EatAction`, `DrankAction`, and `Meal`.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- Updated dependencies [ea24fda]
- Updated dependencies [fd58a46]
- Updated dependencies [651d031]
- Updated dependencies [0f72f02]
  - @chronicle.app/etl-sqlite@0.3.0
  - @chronicle.app/icloud@0.3.0
