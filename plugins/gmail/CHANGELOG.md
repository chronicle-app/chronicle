# @chronicle.app/gmail

## 0.4.0

### Minor Changes

- 3b3a921: A Gmail plugin reads your Gmail through the API, newest first, or from a Google Takeout mbox, with each message in its `Thread` and its labels as `tags`. `--sent` and `--label` pick what to extract with either, and `--query` takes any Gmail search with the API. Spam and Trash are left out unless named with `--label`. Mail in Sent is yours (`@me`).

  A shared mail package reads mbox files as a stream and parses messages with postal-mime, so quoted-printable, base64, and HTML-only bodies come through. A message's body is what its sender wrote, as plain text or Markdown: HTML becomes Markdown; quoted history and signatures are removed with email-reply-parser; bulk mail loses its footer; and images, tracking parameters, and click-tracking redirect URLs are left out. Only the headers a source reads are kept in the raw record. The email plugin uses it too. Messages are now keyed by Message-ID in the `email` namespace, the protocol's own, without its angle brackets, and the email plugin's messages get this new key. so the same email from Gmail, a Takeout, or another mbox is one message, and a Gmail message is `sameAs` Gmail's ID for it in the mailbox; Gmail messages and threads link into Gmail with `deepLinks`. People keep the `email` namespace other plugins link to, now with the address lowercased. A message's text is its `body`, where it was its `description`, and a reply is `inReplyTo` the message it answers.

- ee0525c: You are one node across Google sources: your address as an `email` Agent, `sameAs` `@me` and your Google account, an Agent keyed by the same address in the `google-account` namespace (`googleAccount(address)` in `@chronicle.app/google`). The vocabulary adds `inAccount`: the agent whose account holds an entity, as that account's service knows them, which an entity held in several accounts has for each, and whose own identifiers are unique within it. A Gmail message is `inAccount` the account at the mailbox's address (`emailAccount(address)` in `@chronicle.app/email-core`), as any mail source of that mailbox can say. A Gmail thread is `inAccount` the Google account, which issued its ID, and keyed within it. Gmail's own message IDs are no longer kept: the Message-ID identifies the message. Gmail's thread links name their account with `authuser`, so they open in the right one, and there's no per-message link. `messageAction` takes the `account` holding a message and `meIdentities`, linked from every agent that's the owner, and writes the author by key, since the action's agent is the same person in full. A Google account's own calendar, whose ID is its address, is `inAccount` that account, so a calendar shared with you is its owner's; other calendars don't say whose they are. A calendar event is now keyed by its iCalendar UID, as the planning is, and `sameAs` each calendar's copy by its `eid`, as a Gmail message is keyed by its Message-ID. Google Reader keys its account link by address instead of user ID. In Google Calendar, you are the signed-in account's address wherever it appears, or a guest marked as your primary calendar's owner, not the owner of a calendar shared with you. Every event's agent is who put it on the calendar: the organizer, or the creator when the organizer is a calendar, else the calendar's owner or the calendar itself. Calendars are a new `Calendar`, a kind of `Collection`. The vocabulary adds `alternateName`, another name an entity was shown with. A display name in a mail header or an invitation is now the address's `alternateName`, not its `name`: it's what one message called it, and a group or notification address carries a different one in nearly every message. A calendar has a `name` only when its summary isn't its ID. With `--link-contacts`, a person on one of your contacts is `sameAs` the contact itself, keyed by its ID within your Google account (`google-contacts`), named as you saved it, and `sameAs` its other addresses and numbers.

### Patch Changes

- Updated dependencies [3b3a921]
- Updated dependencies [ee0525c]
- Updated dependencies [3b3a921]
- Updated dependencies [3b3a921]
- Updated dependencies [2148753]
- Updated dependencies [e6a3487]
- Updated dependencies [59904c0]
  - @chronicle.app/email-core@0.4.0
  - @chronicle.app/google@0.4.0
  - @chronicle.app/logging@0.4.0
