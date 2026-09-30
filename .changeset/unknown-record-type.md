---
'@chronicle.app/cli': patch
---

An unknown `--type` is now a short usage error (exit code 2) with a hint that lists the source's kinds, and suggests the closest one when it's a near miss, instead of the source's whole help.
