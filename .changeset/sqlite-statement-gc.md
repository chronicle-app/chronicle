---
'@chronicle.app/etl-sqlite': patch
'@chronicle.app/call-history': patch
'@chronicle.app/safari': patch
'@chronicle.app/timing-app': patch
'@chronicle.app/whatsapp': patch
'@chronicle.app/zotero': patch
---

Fix extractions that could fail partway with "statement has been finalized" on Node 22.13. `iterateRows` now keeps its statement referenced until iteration ends, and every extractor that iterated an inline `db.prepare(sql).iterate()` uses it.
