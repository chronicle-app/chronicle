---
'@chronicle.app/apple-call-history': minor
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/arc-timeline': minor
'@chronicle.app/arena': minor
'@chronicle.app/bluesky': minor
'@chronicle.app/claude-code': minor
'@chronicle.app/email': minor
'@chronicle.app/email-core': minor
'@chronicle.app/facebook': minor
'@chronicle.app/foodnoms': minor
'@chronicle.app/github': minor
'@chronicle.app/gmail': minor
'@chronicle.app/google-calendar': minor
'@chronicle.app/google-reader': minor
'@chronicle.app/hackernews': minor
'@chronicle.app/imessage': minor
'@chronicle.app/instagram': minor
'@chronicle.app/lastfm': minor
'@chronicle.app/linkedin': minor
'@chronicle.app/marvin': minor
'@chronicle.app/slack': minor
'@chronicle.app/things-todo': minor
'@chronicle.app/timing-app': minor
'@chronicle.app/twitter': minor
'@chronicle.app/whatsapp': minor
'@chronicle.app/youtube': minor
'@chronicle.app/zotero': minor
'@chronicle.app/schema': patch
'@chronicle.app/schema-site': patch
'@chronicle.app/cli': patch
---

An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message.

Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.
