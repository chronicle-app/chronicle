---
'@chronicle.app/schema': minor
---

Carry the vocabulary's existing definitions over in full where they had been trimmed. Adds `Event`, `Interval`, `Date`, `DataType`, `relation`, and `involvement`. `startTime` and `endTime` also apply to `Event` and `Interval` and accept a civil `Date`, `location` applies to `Event`, `member` is a kind of `involvement`, and `inReplyTo` a kind of `relation`. `Text`, `DateTime`, `Date`, and `Number` are `DataType`s, and `URL` is a `Text`. Because `startTime` and `endTime` now admit a `Date` string, a string value is kept as-is rather than coerced to an instant.
