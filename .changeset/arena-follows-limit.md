---
'@chronicle.app/arena': patch
---

`--limit` now caps Are.na follows. The follows extractor sends every follow in one record, so the limit never applied and all follows were emitted.
