---
'@chronicle.app/email-core': minor
'@chronicle.app/google': minor
'@chronicle.app/gmail': minor
'@chronicle.app/google-calendar': minor
'@chronicle.app/google-reader': minor
'@chronicle.app/schema': minor
---

You are one node across Google sources: your address as an `email` Agent, `sameAs` `@me` and your Google account, an Agent keyed by the same address in the `google-account` namespace (`googleAccount(address)` in `@chronicle.app/google`). The vocabulary adds `inAccount`, an account that holds an entity, whose own identifiers are unique within it. A Gmail message is `inAccount` the Google account the mailbox is, and Gmail's message and thread IDs are keyed within it rather than in a `gmail` mailbox realm. `messageAction` takes the `account` holding a message, `identity.inAccount` instead of `identity.inRealm`, and `meIdentities`, linked from every agent that's the owner; Gmail links the mailbox's address and mail you sent. A Google calendar is `inAccount` the account whose calendar list it's on. Google Reader keys its account link by address instead of user ID. In Google Calendar, you are the signed-in account's address wherever it appears, or a guest marked as your primary calendar's owner, not the owner of a calendar shared with you. Every event's agent is who put it on the calendar: the organizer, or the creator when the organizer is a calendar, else the calendar's owner or the calendar itself. Calendars are a new `Calendar`, a kind of `Collection`.
