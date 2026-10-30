---
'@chronicle.app/etl': patch
'@chronicle.app/cli': patch
---

A run with `--loader http` shows its progress until it ends. The CLI hides progress once records start loading, so it doesn't mix with records printed to the terminal, but the `http` loader prints none. A loader says whether it prints records with `static printsRecords`, which is `true` unless it sets otherwise.
