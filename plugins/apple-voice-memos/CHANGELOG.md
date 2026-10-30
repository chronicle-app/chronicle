# @chronicle.app/apple-voice-memos

## 0.6.0

### Patch Changes

- @chronicle.app/apple@0.6.0
  - @chronicle.app/etl-sqlite@0.6.0

## 0.5.0

### Minor Changes

- d69e45f: An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

  An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

  An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

  Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message. A Google Calendar event that names no one, such as a holiday or a subscribed feed's, has no agent, rather than its calendar standing in as an `Agent` with the calendar's ID.

  Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

  Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.

- 9d6d834: iMessage, Apple Call History, Voice Memos, Apple Wallet, Shazam, Things, Apple Podcasts, and WhatsApp declare the tables and columns they read in their app's database, so `chronicle scan ~/Library/Messages` finds a `chat.db`, as does a scan of any folder with a copy of one, and extract refuses a version of the database it can't read. A scan of a folder calls what it finds by its schema a database, as in "Found 2 exports and 1 database", and when it finds only databases where their apps keep them, doesn't list the rest of the folder, the app's own, as unrecognized.
- 266f585: `chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle scan` finds ready, all at once, and fills in a table as each answers, with where each count comes from. A source that isn't ready is listed with what's in its way, and what to do about it. One read online is listed as not surveyable, with the command that extracts it, and so, in a survey of a folder, a zip, or one source, is one that can't say how much it holds. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

  An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.

### Patch Changes

- 27ce35d: `@chronicle.app/icloud` is now `@chronicle.app/apple`, since it reads Apple data on a Mac beyond iCloud: the Apple Account signed in, AddressBook contacts, and now binary property lists. Its exports are unchanged, and records still name the Apple Account `icloud`, so every identity stays the same. It adds `parseBinaryPlist` and `Uid`, which read a binary property list such as an NSKeyedArchiver archive; the Shazam plugin, which had its own, now uses them. The plugins that used `@chronicle.app/icloud` depend on `@chronicle.app/apple` instead.
- 1d04da0: Apple Podcasts, Voice Memos, Chrome, FoodNoms, Things, and WhatsApp list Full Disk Access among what they need, so `chronicle sources info` says so. On Linux and Windows, `sources info` leaves Full Disk Access out, since only macOS grants it.
- 67d3035: `chronicle scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

  A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.

- Updated dependencies [27ce35d]
- Updated dependencies [679e9c8]
- Updated dependencies [b112f78]
- Updated dependencies [266f585]
  - @chronicle.app/apple@0.5.0
  - @chronicle.app/etl-sqlite@0.5.0

## 0.4.0

### Minor Changes

- ac25170: Add the Apple Voice Memos plugin, run as `chronicle extract apple-voice-memos`. It extracts the recordings in the Voice Memos library on a Mac, which syncs through iCloud and so holds memos from every device on the account. Each memo is a `RecordAction` dated when recording started, and its `result` is the recording, an `AudioObject` keyed by the memo's ID, with its title, duration, and file. Apple's transcript, when the memo has one, is the recording's `transcript`. The action's `instrument` is what the audio file says recorded it: the OS release, an `OperatingSystem` as the file writes it, and the kind of device, a `ProductModel` keyed by its Wikidata ID, but never which device. Memos in Recently Deleted are left out.

  The vocabulary adds two kinds of `CreateAction`, `RecordAction` for recording sound or video and `PhotographAction` for taking a photograph, and `transcript`, the words spoken in an audio or video recording or a podcast episode, written out as text. `Software` is the new parent of `SoftwareApplication`, `OperatingSystem` (an operating system or one release of it), and `AIModel` (a trained model, such as a language model).

### Patch Changes

- Updated dependencies [b0982a5]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/icloud@0.4.0
