---
'@chronicle.app/cli': patch
---

An unknown `--type` is now a short usage error (exit code 2) with a hint that lists the source's kinds, and suggests the closest one when it's a near miss, instead of the source's whole help.

The `--list-types` hint suggests a single kind, since kinds read by separate extractors can't run together.

A flag a source doesn't have is a usage error too, suggesting the likeliest flag (`-T` → `-t` / `--type`) and pointing at the source's `--help` and `--list-types`, instead of the generic `extract` usage that lists none of the source's flags. A source's `--help` lists `--type` and `--list-types` with the other common flags.
