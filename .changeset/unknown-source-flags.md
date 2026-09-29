---
'@chronicle.app/cli': patch
---

`chronicle extract` reports an unknown source as "No source named …" (or offers to install a catalog source) even when the command includes that source's own flags, such as `--limit`, instead of failing on the flag first.
