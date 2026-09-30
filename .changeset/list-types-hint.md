---
'@chronicle.app/cli': patch
---

`extract <source> --list-types` follows the list with a hint on stderr: how to pick kinds with `--type`, a runnable example, and what a run without `--type` reads. The source help now says the same instead of claiming a bare run reads every kind, which was true only for sources whose one extractor emits them all.
