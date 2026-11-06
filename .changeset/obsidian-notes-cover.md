---
'@chronicle.app/obsidian': minor
---

Each file in a vault is now a `Note` instead of a `DocumentObject`, with the same identity. A note named for a period gets a `dateCovered`: a day anywhere in its name, as in `2019-03-14` or `Garden tour (2026-11-06)`, covers that day, `2026-05` as the whole name covers that month, and `2026-W19` that ISO week. A note named by the vault's Daily Notes settings covers its day too, in the folder and format they give.
