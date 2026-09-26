---
'@chronicle.app/etl': minor
---

Declare `keyOf`, `newestFirst` and `frontierThreshold` on `Extractor` so plugins can state their source identity and ordering ahead of an incremental-import cursor. Nothing reads them yet; extraction is unchanged.
