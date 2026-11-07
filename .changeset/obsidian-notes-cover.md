---
'@chronicle.app/obsidian': minor
---

Each file in a vault is now a `Note` instead of a `DocumentObject`, with the same identity. A note with an ISO 8601 day in its file name, as in `2019-03-14` or `Garden tour (2026-11-06)`, gets a `dateCovered` for that day, and several days give the span from the earliest to the latest.
