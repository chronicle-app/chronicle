# @chronicle.app/etl-sqlite

## 0.6.0

No changes in this release.

## 0.5.0

### Minor Changes

- 679e9c8: Add the Apple Photos plugin, run as `chronicle extract apple-photos`. It reads your Photos library on a Mac in place, read-only, while Photos runs, and reads what Photos knows about each photo and video rather than the files, most of which iCloud keeps off the Mac. Four kinds:

  - `photos`, the default: each photo and video, as what you did to bring it into the library. A camera photo is a `PhotographAction` and a video a `RecordAction`, dated when taken, with the kind of camera as a `ProductModel`, keyed by its make and model in the `exif` namespace. A screenshot is a `ScreenshotAction`, a screen recording a `RecordAction`, and a Live Photo taken during a FaceTime call a `PhotographAction` with FaceTime as its `instrument`. A photo an app saved, such as from WhatsApp or Messages, is an `AddAction` dated when it was added, with the app as its `instrument`. Each action is keyed by the work it made or added: the photo as a `StillImage` or the video as a `MovingImage`, keyed by iCloud's ID for it, with its title, caption, keywords, the people whose faces you named in it as `depicts`, its albums and their folders as `isPartOf`, and the camera's mode it was taken in, such as Portrait or slo-mo, as `sourceFormat`. Each of its original files is a `rendition`, an `ImageObject` or a `VideoObject` keyed by iCloud's fingerprint of the file, with its original file name, size in bytes as `contentSize`, dimensions, type, and length, and a photo's lens and exposure as `exifData`, by EXIF's tag names. A Live Photo has two: its image and its clip. Where it was taken is the action's `location`, or the work's own when an app saved it, since someone else took it. What Photos works out for itself is left out: its model's captions, its search labels, the address it looks up, its guess at which person is you, and the faces it matches to people. So are photos you hid, and photos someone else added to an iCloud Shared Library.
  - `activity`: what you did with your photos, each dated: views, shares, and edits, and from the library's change log, likes and unlikes, caption and title changes, and adds to albums. What follows a photo from iCloud when it arrives, such as after the library is rebuilt, isn't something you did then, and is left out. The change log's bits are looked up by property name in the library's own Core Data model, since they move between macOS versions.
  - `favorites`: your favorites the change log has no date for, from before it begins or that arrived with the photo, each a `LikeAction` with no `timestamp`, keyed by the work.
  - `shared-with-you`: the photos and videos shared with you in Messages, from the library Photos keeps of them, each a `ShareAction` of a work keyed by Messages' attachment ID, crediting who sent it from Messages and dated when they sent it. The work's `rendition` is the attachment as the iMessage plugin keys it. A photo shared in a group chat `target`s the group's `Channel`, keyed as the iMessage plugin keys it.

  A photo or video's work links into Photos by its key, with a `deepLinks` template that opens Photos with it selected.

  `chronicle scan` finds the library in `~/Pictures`, and a scan of a folder finds a library's `Photos.sqlite` by the tables the plugin declares it reads. Extract refuses a database that isn't a Photos library, or one from a Photos without a column it reads, and `chronicle sources info` says it needs Full Disk Access. `chronicle survey` counts each kind, and when, without extracting it: photos and Shared with You from their rows alone, and activity and favorites from the change log, as a run reads it.

  `@chronicle.app/etl-sqlite` adds `assertDatabaseSchema`, the check a `SqliteExtractor` makes of its declared schema, for a reader that opens its database itself.

  The vocabulary adds `ScreenshotAction`; `UnlikeAction`, which withdraws a like; `likes`, the entities an agent likes, which a `LikeAction` adds to and an `UnlikeAction` removes from, declared with the new `assertedBy`, `retractedBy`, and `runPredicate` annotations; `ShareAction`, which maps to schema.org's; `depicts`, something that appears in a picture or video, such as a person; `exifData`, what an image's file records about how it was taken, as an object of EXIF tags and their values, in a new `JSONObject` datatype; `StillImage` and `MovingImage`, a picture or a video as a work, apart from the files that hold it; and `rendition`, a file that holds a work, such as a picture's image file and the short video captured with it, or an episode's audio, which maps to schema.org's `encoding`; and `contentSize`, a media file's size in bytes. `contains` is a file that's part of an entity, such as a message's attachment. `caption` applies to a `StillImage` and a `MovingImage` as well as an `ImageObject`.

- 266f585: `chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle scan` finds ready, all at once, and fills in a table as each answers, with where each count comes from. A source that isn't ready is listed with what's in its way, and what to do about it. One read online is listed as not surveyable, with the command that extracts it, and so, in a survey of a folder, a zip, or one source, is one that can't say how much it holds. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

  An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.

## 0.4.0

### Minor Changes

- b0982a5: Add the Chrome plugin. It reads browsing history from a Chrome profile's `History` database, including visits synced from other devices, and emits a `ViewAction` for each page visit. The agent is the profile's Google account, by its email address, as Gmail and Google Calendar know you. A visit reached by following a link or submitting a form also becomes a `NavigateAction` from the page it came from to the page it landed on, and that page `references` the link followed. The vocabulary adds `MoveAction` and `NavigateAction`. `@chronicle.app/etl-sqlite` adds `chromeToUnixMsSql` and `unixMsToChromeTimestamp` for Chromium's microseconds since 1601. `renderShapes` shows each further action a record becomes as its own node.

### Patch Changes

- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.

## 0.3.0

### Minor Changes

- ea24fda: Add a protected `openDatabase(path)` to `SqliteExtractor` so subclasses can read a copy of a locked database or a database from a backup, `isSqliteBusy(err)` to recognize SQLITE_BUSY errors, and typed `allRows`, `getRow` and `iterateRows` statement helpers. The README now lists the `node:sqlite` differences that break code ported from better-sqlite3.

### Patch Changes

- 651d031: Fix extractions that could fail partway with "statement has been finalized" on Node 22.13. `iterateRows` now keeps its statement referenced until iteration ends, and every extractor that iterated an inline `db.prepare(sql).iterate()` uses it.

## 0.2.0

### Patch Changes

- c097762: Declare `@chronicle.app/etl` and `@chronicle.app/schema` as peer dependencies (`>=0.1.0 <1.0.0`) instead of exact dependencies, so plugins and the packages they build on share the host's copy instead of installing their own.
