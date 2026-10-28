# @chronicle.app/facebook

## 0.5.0

### Minor Changes

- d69e45f: An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

  An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

  An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

  Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message. A Google Calendar event that names no one, such as a holiday or a subscribed feed's, has no agent, rather than its calendar standing in as an `Agent` with the calendar's ID.

  Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

  Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.

- d8569f2: `ArchiveExtractor` opens `--input` with `openExport`, so the Facebook, Instagram, and LinkedIn readers take their export as the zip the service hands over, or unzipped as before, and read it in place. A subclass reads files by their paths in the export. Each declares its export's layout, so `chronicle scan <path>` finds it. `ExportFiles` lists a folder's names with `children(folder)` and gives a reader outside the export a file on disk with `localPath(path)`, a copy out of a zip that lasts until the export is closed, so Instagram's posts and stories keep their media from a zip. `openExport` takes what to call the export in its messages, like `LinkedIn export`.
- 5ed2312: Apple Health, Facebook, Instagram, LinkedIn, Slack, Twitter, and YouTube Takeout survey what their exports hold, so `chronicle survey` counts what they would extract, and when each record happened. The exports have no index, so a survey reads the export as a run does, keeping only counts and times. Messages say how many conversations they're in, and YouTube's watches how many videos. Twitter's likes have a count but no dates, since the archive doesn't say when you liked anything. A Slack run's progress total now follows `--since`, `--until`, and `--limit`.

## 0.4.0

No changes in this release.

## 0.3.0

### Minor Changes

- 80598fa: Add the Facebook plugin, bundled with the CLI. It reads a Facebook data export and emits a `MessageAction` for each Messenger message, a `FindAction` with a `Query` for each search, a `LikeAction` for each like, and a `RespondAction` for each reaction or comment. The vocabulary adds `FindAction`, `Query`, `AssessAction`, `ReactAction`, `LikeAction`, `RespondAction`, `Post`, `Response`, and `Comment`, and `author` now applies to any `CreativeWork`.

### Patch Changes

- f400092: `chronicle sources` lists one row per source from a plugin catalog that ships with the CLI, with whether each source is installed or can run on this machine. Legacy sources for services that no longer exist (Google Reader, Moves, Marvin) are hidden unless you pass `--all`; the table says how many it left out, and marks them legacy when shown. `sources` and `sources info` read each plugin's `chronicle` manifest in its package.json instead of importing the plugin, and `sources info` shows the platforms and permissions a source needs. `--format json` now has one object per source, with its strategies nested under `strategies`. The table's Via column is now Strategy, `extract` takes `--strategy` (`--via` is gone), and help and messages say "strategies" instead of "ways in".
- f400092: The CLI bundles only shell, imessage, safari, things-todo, and claude-code. Install any other source with `chronicle plugins install <name>`, using its short name from `chronicle sources`, or run `chronicle extract <source>` on a terminal and accept the offer to install it. `plugins install` also takes a package name or a local path, and installs into the Chronicle data directory with your own npm; `chronicle plugins` lists installed plugins and `plugins uninstall` removes one. Plugins installed beside the CLI with `npm install -g` are now found, and plugins in the current directory's `node_modules` no longer are. Installed plugins share the CLI's `@chronicle.app/etl`, `schema`, and `auth`, so their OAuth providers appear in `chronicle auth`. The CLI no longer depends on `@oclif/plugin-plugins`, and plugins drop their empty `oclif` field.
- 91e6783: `chronicle sources` fits its table to the terminal: narrow columns size to their content and never wrap, and Record Types and Description share the rest of the width, truncating only when they have to. `--format json` includes each extractor's `default`. Facebook defaults to Messenger conversations and Instagram to posts, so `chronicle extract facebook` and `chronicle extract instagram` work without `--type`.
