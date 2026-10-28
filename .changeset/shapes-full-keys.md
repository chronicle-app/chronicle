---
'@chronicle.app/etl': patch
---

A plugin's SHAPES.md lists each node's whole key, `@type` and `source` too, so a key that leaves one out shows it: one without `source` is shared across sources, and one without `@type` keeps its identity when its type changes. It no longer writes `any source`.
