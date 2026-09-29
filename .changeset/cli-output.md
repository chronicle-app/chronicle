---
'@chronicle.app/cli': minor
'@chronicle.app/etl': minor
---

Redesign extraction output. A run shows a live line on stderr (spinner, bar, count, rate, clock, and the record in hand) and ends with a one-line summary, with a hint when the default `--limit` cut it short. The CSV and table loaders show readable columns: no JSON-LD bookkeeping, nested nodes as their labels, lists joined, and every record's columns. The table fits the terminal, moves constant columns into a caption, and prints a single record as a card. `--columns schema` keeps every Chronicle schema property as its own dotted column instead. After CSV or table output, stderr hints at the columns the table had no room for and at `--columns schema` when it would show more.
