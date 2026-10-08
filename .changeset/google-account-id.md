---
'@chronicle.app/google': minor
'@chronicle.app/gmail': minor
'@chronicle.app/google-calendar': minor
---

Gmail and Google Calendar link you to your Google account by its Gaia id, Google's permanent id for the account. From the API, the mailbox's own address in Gmail, and you on your primary calendar in Calendar, are `sameAs` a `google-account` Agent keyed by the id, the node Chrome and Google Reader name too. `GoogleApi.gaiaId()` reads it from OpenID's userinfo, which every Google sign-in already allows; without it, a run goes on without the link. `googleAccount(gaiaId)` builds the node.
