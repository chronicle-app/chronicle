# @chronicle.app/github

## 0.6.0

### Patch Changes

- @chronicle.app/auth@0.6.0

## 0.5.0

### Minor Changes

- d69e45f: An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

  An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

  An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

  Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message. A Google Calendar event that names no one, such as a holiday or a subscribed feed's, has no agent, rather than its calendar standing in as an `Agent` with the calendar's ID.

  Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

  Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.

- e74de55: An issue's text, a pull request's, and a commit message after its subject line are their `description` instead of their `body`. That text describes the work, as a to-do's notes do. A comment's text stays its `body`.
- f4a7c4e: A repository is keyed by its owner as well as its name, and an issue, a pull request, or a star by its repository's owner and name. Their keys named the owner and the repository through lists without `[*]`, so they read nothing: repositories with the same name were one node whoever owned them, as were issues and pull requests with the same number in different repositories, and stars of repositories with the same name. Repositories, issues, pull requests, and stars extracted before this change were keyed differently, so extracting them again makes new nodes.
- c7d0f22: GitHub repositories are keyed by their owner's login and their own name, the `owner/name` in their URL and git remotes, instead of by the owner's numeric id and the name. A repository's `handle` is its name. Issues, pull requests, and stars are keyed through their repository the same way. A repository now becomes a new node when its owner changes their login, as it already did when it was renamed or transferred. Repositories, issues, pull requests, and stars extracted before this change were keyed differently, so extracting them again makes new nodes.
- 67d3035: `chronicle scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

  A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.

### Patch Changes

- @chronicle.app/auth@0.5.0

## 0.4.0

### Minor Changes

- 61ad43e: A GitHub plugin reads your pull requests, issues, commits, repositories, how issues and pull requests were resolved, comments, stars, and gists through the GitHub GraphQL API, plus other people's replies to you. An issue is a `Task` (opened with a `PlanAction`, closed with a `CompleteAction` or `CancelAction`); a pull request is a `Changeset` (opened with a `PublishAction`, merged with an `AcceptAction`, declined with a `RejectAction`, or withdrawn with a `CancelAction`). It signs in with `--token`, a token stored with `chronicle auth set github`, `GH_TOKEN`, `GITHUB_TOKEN`, or the gh CLI's login. A commit is a `Revision`, keyed by its hash across sources and `isBasedOn` its parents. The vocabulary adds `SoftwareSourceCode`, `Repository`, `Changeset`, `Revision`, `AcceptAction`, `RejectAction`, and `isBasedOn`.
- 32d4b05: Record kinds can follow the source (`chronicle extract github stars gists`), and kinds read by separate extractors now run together instead of failing as ambiguous: newest first when each extractor implements the new `occurredAt(record)` hook, one after another otherwise. `-t all` reads every kind, `-t defaults` the plugin's defaults. A plugin that declares no default kinds gets a picker on a bare run (space selects, enter starts, `a` all, `d` defaults), and outside a terminal an error saying how to name kinds; GitHub declares none. A run of several kinds says which it reads, and which it leaves out. The run summary puts the outcome on one line and a line per kind under it.

### Patch Changes

- Updated dependencies [a7fb44c]
- Updated dependencies [3b3a921]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/auth@0.4.0
