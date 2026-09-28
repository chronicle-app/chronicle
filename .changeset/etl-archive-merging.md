---
'@chronicle.app/etl': minor
---

Add `ArchiveExtractor`, a base for takeout-style exports read in place; `MergingExtractor`, which merges several newest-first child extractors into one newest-first stream under a single limit; and `SystemInfo`, which reads the user's name, hostname, and platform identifier on macOS, Linux, and Windows.
