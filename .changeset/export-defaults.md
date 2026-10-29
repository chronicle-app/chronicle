---
'@chronicle.app/cli': patch
---

A source's export strategy can declare default record types of its own, which a run with `--input` reads, beside the default a bare run takes. A run without `--input` takes the default strategy that reads without a file, whatever order the strategies are declared in, and `chronicle sources info` and a source's help call that one the default.
