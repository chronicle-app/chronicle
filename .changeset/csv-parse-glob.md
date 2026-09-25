---
'@chronicle.app/etl': patch
'@chronicle.app/cli': patch
---

Upgrade `csv-parse` to 7, which fixes a prototype-replacement advisory in the `columns` option (GHSA-8cw4-87c7-c6xx), and the CLI's `glob` to 13, replacing a deprecated release.
