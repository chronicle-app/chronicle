---
'@chronicle.app/etl': minor
'@chronicle.app/schema': minor
'@chronicle.app/things-todo': patch
---

`ChronicleTransformer` marks every node of a snapshot source's payload `@asserts: ['*']`, a complete read of its current values, so values that have since gone away can be closed. `Base` declares `@asserts`. Things tasks now carry the marker. Payloads are labelled by source, type, and their end, start, or event time instead of their `sourceId`.
