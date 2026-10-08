---
'@chronicle.app/email-core': minor
'@chronicle.app/google': minor
'@chronicle.app/gmail': minor
'@chronicle.app/google-calendar': minor
'@chronicle.app/google-reader': minor
'@chronicle.app/schema': minor
---

You are one node across Google sources: your address as an `email` Agent, `sameAs` `@me` and your Google account, an Agent keyed by the same address in the `google-account` namespace (`googleAccount(address)` in `@chronicle.app/google`). The vocabulary adds `inAccount`: an account that holds an entity, which an entity held in several accounts has for each, and whose own identifiers are unique within it. A Gmail message is `inAccount` the account at the mailbox's address (`emailAccount(address)` in `@chronicle.app/email-core`), as any mail source of that mailbox can say. A Gmail thread is `inAccount` the Google account, which issued its ID, and keyed within it. Gmail's own message IDs are no longer kept: the Message-ID identifies the message. Gmail's thread links name their account with `authuser`, so they open in the right one, and there's no per-message link. `messageAction` takes the `account` holding a message and `meIdentities`, linked from every agent that's the owner, and writes the author by key, since the action's agent is the same person in full. A Google calendar is `inAccount` the Google account whose calendar list it's on. Google Reader keys its account link by address instead of user ID. In Google Calendar, you are the signed-in account's address wherever it appears, or a guest marked as your primary calendar's owner, not the owner of a calendar shared with you. Every event's agent is who put it on the calendar: the organizer, or the creator when the organizer is a calendar, else the calendar's owner or the calendar itself. Calendars are a new `Calendar`, a kind of `Collection`.
