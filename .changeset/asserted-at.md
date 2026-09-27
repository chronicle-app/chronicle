---
'@chronicle.app/etl': minor
'@chronicle.app/schema': minor
---

`ChronicleTransformer` stamps `@assertedAt` on each payload that doesn't set one: an event at its own `timestamp`, `startTime`, or `endTime` (none without one), and a snapshot at the extraction's read time. `Base` declares `@assertedAt` as a date or string.
