---
'@chronicle.app/imessage': minor
'@chronicle.app/schema': minor
---

An iMessage `MessageAction` has its `Message` as its `result`, not its `object`, since sending a message brings it into being, as a call's session is its `CallAction`'s `result`. The vocabulary's `MessageAction` says so, and its iMessage examples show it. The other messaging plugins still put the message in `object` for now.
