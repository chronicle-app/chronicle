---
'@chronicle.app/email-core': minor
'@chronicle.app/email': minor
'@chronicle.app/google': minor
'@chronicle.app/gmail': minor
'@chronicle.app/google-calendar': minor
'@chronicle.app/google-reader': minor
'@chronicle.app/schema': minor
---

You are one node across Google sources: your address as an `email` Agent, `sameAs` `@me` and your Google account, an Agent keyed by the same address in the `google-account` namespace (`googleAccount(address)` in `@chronicle.app/google`). Gmail links the mailbox's address and mail you sent, through `messageAction`'s new `meIdentities`, and keys its message and thread IDs in the mailbox, a `Realm` at its address in the `email` namespace (`mailbox(address)` in `@chronicle.app/email-core`), `sameAs` the Google account's realm. The email plugin's new `--account` puts an mbox's copies in the same mailbox and marks you there, and Google Reader keys its account link by address instead of user ID. In Google Calendar, you are the signed-in account's address wherever it appears, or a guest marked as your primary calendar's owner, not the owner of a calendar shared with you. Every event's agent is who put it on the calendar: the organizer, or the creator when the organizer is a calendar, else the calendar's owner or the calendar itself. Calendars are a new `Calendar`, a kind of `Collection`.
