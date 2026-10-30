---
'@chronicle.app/logging': patch
'@chronicle.app/etl': patch
'@chronicle.app/cli': patch
'@chronicle.app/gmail': patch
'@chronicle.app/google-calendar': patch
---

Each record carries a label, its type, title, and date, and a run shows it for the record in hand and in each failed or skipped record, set apart with `·`: `ViewAction · 2025-03-04 18:22 · A page title`. The date is in local time to the minute, and `--log-format json` leaves out the title and date. An extractor labels its records from the record type, the new `titleOf(record)` hook (else the data's first `name`, `title`, … `url`), and `occurredAt(record)`. A `ChronicleTransformer` relabels each payload with its `@type`, what names it, and its `timestamp`, `startTime`, or `endTime`, and a transformer after it, such as one making another system's payload, keeps that label. This replaces a record's `toString` text, and the `recordToString` hooks with `titleOf` on extractors and `labelOf` on transformers.
