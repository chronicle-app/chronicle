---
'@chronicle.app/google-contacts': minor
'@chronicle.app/google': minor
---

A Google Contacts plugin reads your contacts, most recently edited first. Each is a `Person` on the `UpdateAction` of your last edit to it (Google keeps no other history), with its labels as `tags`, its current organization as `memberOf`, its photo, and `sameAs` links to the `email` and `phone` identities other sources key people by. `chronicle auth login google --add contacts` adds the access.
