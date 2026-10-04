---
'@chronicle.app/etl': minor
---

JSON output is more compact. Arrays and objects that fit within 100 columns stay on one line, and long lists of plain values, such as `@key` paths, fill each line instead of taking one line per item. Each record still opens on its own lines and parses to the same value. `formatJson` gives the same layout without color.
