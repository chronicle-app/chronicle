# @chronicle.app/chrome

## 0.5.0

### Minor Changes

- 67d3035: `chronicle scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

  A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.

- 266f585: `chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle scan` finds ready, all at once, and fills in a table as each answers, with where each count comes from. A source that isn't ready is listed with what's in its way, and what to do about it. One read online is listed as not surveyable, with the command that extracts it, and so, in a survey of a folder, a zip, or one source, is one that can't say how much it holds. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

  An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.

### Patch Changes

- 1d04da0: Apple Podcasts, Voice Memos, Chrome, FoodNoms, Things, and WhatsApp list Full Disk Access among what they need, so `chronicle sources info` says so. On Linux and Windows, `sources info` leaves Full Disk Access out, since only macOS grants it.
- Updated dependencies [266f585]
  - @chronicle.app/etl-sqlite@0.5.0
  - @chronicle.app/google@0.5.0

## 0.4.0

### Minor Changes

- b0982a5: Add the Chrome plugin. It reads browsing history from a Chrome profile's `History` database, including visits synced from other devices, and emits a `ViewAction` for each page visit. The agent is the profile's Google account, by its email address, as Gmail and Google Calendar know you. A visit reached by following a link or submitting a form also becomes a `NavigateAction` from the page it came from to the page it landed on, and that page `references` the link followed. The vocabulary adds `MoveAction` and `NavigateAction`. `@chronicle.app/etl-sqlite` adds `chromeToUnixMsSql` and `unixMsToChromeTimestamp` for Chromium's microseconds since 1601. `renderShapes` shows each further action a record becomes as its own node.

### Patch Changes

- Updated dependencies [b0982a5]
- Updated dependencies [ee0525c]
- Updated dependencies [3b3a921]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/google@0.4.0
