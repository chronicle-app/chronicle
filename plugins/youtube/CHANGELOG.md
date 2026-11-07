# @chronicle.app/youtube

## 0.6.0

### Minor Changes

- 4566669: YouTube signs in with the Google sign-in Gmail and Google Calendar use, instead of a sign-in and OAuth client of its own. Run `chronicle auth login google --add youtube` to add it, which turns the YouTube Data API on in your Google Cloud project. A YouTube sign-in made before is no longer read. A YouTube run takes `--account` to pick one of several Google accounts, and Google's refusals say what to run, as Gmail's do.

### Patch Changes

- 0341b5d: A search's `Query` has its text as `body` only, as the vocabulary says, and no longer repeats it as `name`. Its key, by `body`, is unchanged.
- Updated dependencies [4566669]
  - @chronicle.app/google@0.6.0
  - @chronicle.app/auth@0.6.0

## 0.5.0

### Minor Changes

- d69e45f: An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

  An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

  An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

  Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message. A Google Calendar event that names no one, such as a holiday or a subscribed feed's, has no agent, rather than its calendar standing in as an `Agent` with the calendar's ID.

  Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

  Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.

- 5ed2312: Apple Health, Facebook, Instagram, LinkedIn, Slack, Twitter, and YouTube Takeout survey what their exports hold, so `chronicle survey` counts what they would extract, and when each record happened. The exports have no index, so a survey reads the export as a run does, keeping only counts and times. Messages say how many conversations they're in, and YouTube's watches how many videos. Twitter's likes have a count but no dates, since the archive doesn't say when you liked anything. A Slack run's progress total now follows `--since`, `--until`, and `--limit`.
- 3d7e290: YouTube's Takeout reader takes the Takeout itself, as a folder, a zip, or one part of a split Takeout, as well as its "YouTube and YouTube Music" folder, and reads a zip in place. Its manifest declares the Takeout's layout, so `chronicle scan <path>` finds one however it's kept, and a Takeout with its history in JSON shows as a layout it can't read yet. `ExportFiles` says when each file was last changed with `modified(path)`, in a zip from its index, so a zipped Takeout has the same as-of time as the unzipped one. `writeZip` dates a fixture's entries with `modified`.

### Patch Changes

- @chronicle.app/auth@0.5.0

## 0.4.0

### Patch Changes

- 59904c0: Name failures, and exit with codes a supervisor can act on. `@chronicle.app/etl` exports typed errors: `AuthRequired` (exit 3), `InputNotFound` and `PermissionDenied` (4), `RateLimited` with `retryAfter` (5), and `ExtractorError` with any `code`, each with a `hint` for the next step. `ApiAuthError` and `ApiRateLimitError` are now the typed ones. The runner reports an error that ends a run as an `error` event with its code, exit code, and hint; the CLI prints it once, the hint beneath, and exits with its code. A missing or unreadable input names the file and exits 4, and every SQLite source now explains a macOS Full Disk Access refusal instead of printing `unable to open database file`. Credentials problems point to `chronicle auth login <source>`. Plugins can add a next step to a successful run with `this.hint(message, { action })`, printed under the summary. `fileError` and `assertReadable` turn file-system failures into typed errors. Hints are marked `↳` and wrap without splitting a `code span`. Things reports a blocked or missing library folder the same way, instead of a raw `EPERM: scandir`, and a typed error thrown while a run is being built is reported like one from the run.
- Updated dependencies [a7fb44c]
- Updated dependencies [3b3a921]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/auth@0.4.0

## 0.3.0

### Minor Changes

- 17f4d09: Add the YouTube plugin, bundled with the CLI. It reads likes, subscriptions, playlists, and uploads from the YouTube Data API after `chronicle auth login youtube`, or watch and search history, comments, and the library from a Google Takeout folder with `--strategy takeout`. The vocabulary adds `AnnotateAction`, and `MediaObject` and `Collection` now sit under `CreativeWork`.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- @chronicle.app/auth@0.3.0
