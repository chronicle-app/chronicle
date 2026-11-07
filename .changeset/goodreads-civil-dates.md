---
'@chronicle.app/goodreads': patch
---

A book's actions now carry the day Goodreads gives, such as `2025-03-14`, instead of that day's midnight in the time zone of the machine that read the export. The same export now gives the same actions on any machine. These actions are keyed by their date, so importing into a store that already holds them adds new ones beside the old.
