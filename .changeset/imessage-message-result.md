---
'@chronicle.app/imessage': minor
'@chronicle.app/schema': minor
'@chronicle.app/schema-site': patch
'@chronicle.app/etl': patch
---

An iMessage `MessageAction` has its `Message` as its `result`, not its `object`, since sending a message brings it into being, as a call's session is its `CallAction`'s `result`. The vocabulary's `MessageAction` says so, and its examples and the schema site's guides show it. The other messaging plugins still put the message in `object` for now.

iMessage records are events, so a later run adds to what an earlier one stated and doesn't replace it. A store that kept iMessage records from an earlier release has each message as its action's `object` and its `result` once iMessage runs again. Drop those records and extract iMessage again to keep only the `result`.

A run's progress line names an action by its `result` when it has no `object`, so an iMessage run shows each message's text rather than `MessageAction`, and a Photos run each photo's title or file name.
