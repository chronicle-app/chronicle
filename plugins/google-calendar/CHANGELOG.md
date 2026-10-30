# @chronicle.app/google-calendar

## 0.6.0

### Patch Changes

- 057d92d: Each record carries a label, its type, title, and date, and a run shows it for the record in hand and in each failed or skipped record, set apart with `·`: `ViewAction · 2025-03-04 18:22 · A page title`. The date is in local time to the minute, and `--log-format json` leaves out the title and date. An extractor labels its records from the record type, the new `titleOf(record)` hook (else the data's first `name`, `title`, … `url`), and `occurredAt(record)`. A `ChronicleTransformer` relabels each payload with its `@type`, what names it, and its `timestamp`, `startTime`, or `endTime`, and a transformer after it, such as one making another system's payload, keeps that label. This replaces a record's `toString` text, and the `recordToString` hooks with `titleOf` on extractors and `labelOf` on transformers.
- Updated dependencies [4566669]
  - @chronicle.app/google@0.6.0

## 0.5.0

### Minor Changes

- d69e45f: An ID names one thing. An action that a source gives no ID of its own no longer takes the ID of what it acted on or made as its `sourceId`, which gave two nodes one ID. It is keyed through that node instead, by `object.sourceId` or `result.sourceId`, and also by its time where it can happen more than once.

  An action is keyed by what it acted on: a Things action by its task, a Google Calendar plan by its event, an opened GitHub issue by the issue, a Google Reader read, share, or star by the item and you, a Twitter like by the tweet, a Last.fm or YouTube follow by the account it follows, a Zotero save by the item, and a Zotero view by the item and when.

  An action that makes something has it as its `result` and is keyed by it. Every `MessageAction` has its `Message` as its `result`, as iMessage's does: in Claude Code, Email, Gmail, Facebook, Instagram, LinkedIn, Slack, Twitter, and WhatsApp too. A `PublishAction` has the work it published as its `result`: a Bluesky post, an Instagram post, a tweet, a YouTube video, a GitHub pull request or gist, and a Hacker News submission. A call is keyed by its session, a voice memo by its recording, an Arc trip by its journey, and a Timing block or entry by its session. Highlighting is keyed by the quotation it made, in Marvin and Zotero, and commenting by the note or comment it made, in Marvin, Zotero, YouTube, Hacker News, and GitHub. Creating a GitHub repository and committing are keyed by the repository and the commit, creating an Are.na channel, block, or comment by what it made, rather than by IDs made up as `channel-11`, and registering a Last.fm account by the account.

  Nodes that shared an ID are keyed apart. An Instagram post, which the export gives no ID of its own, is keyed by the files it contains rather than by its first file's ID. A FoodNoms entry's ID is its action's, still without `@type`, so the eat-or-drink guess can change, and its `Meal` is keyed by the action it was eaten in. A comment on a Marvin or Zotero highlight, which shares the highlight's ID, is keyed by the quotation it is about. A WhatsApp attachment is keyed by its message. A Google Calendar event that names no one, such as a holiday or a subscribed feed's, has no agent, rather than its calendar standing in as an `Agent` with the calendar's ID.

  Google Reader's Share is a `ShareAction` of the item rather than a `PublishAction`, since it passed along an article someone else wrote. The vocabulary's `PublishAction` says its `result` is the work, and its examples show these keys. The schema site's keys guide and the plugin scaffold say how to key an action without an ID of its own.

  Records these plugins extracted before this release were keyed differently, so extracting them again adds new nodes beside the old ones, and the old messages and publications stay as their actions' `object`. Drop these plugins' records and extract them again.

### Patch Changes

- @chronicle.app/google@0.5.0

## 0.4.0

### Minor Changes

- ee0525c: You are one node across Google sources: your address as an `email` Agent, `sameAs` `@me` and your Google account, an Agent keyed by the same address in the `google-account` namespace (`googleAccount(address)` in `@chronicle.app/google`). The vocabulary adds `inAccount`: the agent whose account holds an entity, as that account's service knows them, which an entity held in several accounts has for each, and whose own identifiers are unique within it. A Gmail message is `inAccount` the account at the mailbox's address (`emailAccount(address)` in `@chronicle.app/email-core`), as any mail source of that mailbox can say. A Gmail thread is `inAccount` the Google account, which issued its ID, and keyed within it. Gmail's own message IDs are no longer kept: the Message-ID identifies the message. Gmail's thread links name their account with `authuser`, so they open in the right one, and there's no per-message link. `messageAction` takes the `account` holding a message and `meIdentities`, linked from every agent that's the owner, and writes the author by key, since the action's agent is the same person in full. A Google account's own calendar, whose ID is its address, is `inAccount` that account, so a calendar shared with you is its owner's; other calendars don't say whose they are. A calendar event is now keyed by its iCalendar UID, as the planning is, and `sameAs` each calendar's copy by its `eid`, as a Gmail message is keyed by its Message-ID. Google Reader keys its account link by address instead of user ID. In Google Calendar, you are the signed-in account's address wherever it appears, or a guest marked as your primary calendar's owner, not the owner of a calendar shared with you. Every event's agent is who put it on the calendar: the organizer, or the creator when the organizer is a calendar, else the calendar's owner or the calendar itself. Calendars are a new `Calendar`, a kind of `Collection`. The vocabulary adds `alternateName`, another name an entity was shown with. A display name in a mail header or an invitation is now the address's `alternateName`, not its `name`: it's what one message called it, and a group or notification address carries a different one in nearly every message. A calendar has a `name` only when its summary isn't its ID. With `--link-contacts`, a person on one of your contacts is `sameAs` the contact itself, keyed by its ID within your Google account (`google-contacts`), named as you saved it, and `sameAs` its other addresses and numbers.
- 3b3a921: Google sources sign in with `chronicle auth login google`, using an OAuth client you make in your own Google Cloud project. The first sign-in walks you through it: gcloud (in a configuration of Chronicle's own) creates the project and turns the APIs on, the Cloud console pages for the consent screen and the client open one at a time, and you paste in the client's ID and secret. Chronicle signs out of gcloud when setup is done. Each account you sign in with is kept apart; `--account` picks one, and `--add drive` asks for more access. A Google Calendar plugin reads your calendars' events, newest first by when they were put on a calendar, as `PlanAction`s keyed by iCalendar UID (in the `icalendar` namespace) on each calendar's copy of the `Event`, keyed by Google's ID for it, linked into Google Calendar with `deepLinks`, and `sameAs` the UID, with their guests as `attendee`s keyed by email address as the mail plugins key people, and descriptions converted from HTML to Markdown. With `--link-contacts`, Gmail and Calendar use your Google Contacts as a lookup: a person on one of your contacts is `sameAs` the contact's other addresses and phone numbers. It's off by default; `--add contacts` adds the access. The vocabulary adds `attendee`, and `scheduledStart` and `scheduledEnd` for when an event or session is planned; `startTime` and `endTime` are for actions only, and the unused `Interval` is removed. `involvement` is abstract, a family to query by rather than a property to set, and `recipient` joins `member` and `attendee` in it.

### Patch Changes

- Updated dependencies [ee0525c]
- Updated dependencies [3b3a921]
  - @chronicle.app/google@0.4.0
