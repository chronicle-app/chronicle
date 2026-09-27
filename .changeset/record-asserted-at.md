---
'@chronicle.app/etl': minor
---

Extractors can pass `createRecord(data, context, { assertedAt })` when they know when the source observed a record, such as an API's per-item fetch time. It is kept as `extraction.recordAssertedAt` and becomes the payload's `@assertedAt` ahead of the event and snapshot defaults, unless the payload sets its own.
