---
'@chronicle.app/cli': patch
---

Every error reads the same way: `✗ Error: <message>`, with the next step as a `↳` hint below, instead of oclif's `› Error:` with the advice folded into the message. That covers errors commands raise, errors that escape them, and oclif's own parse errors, whose "See more help" points at the command's (or the source's) `--help`. A flag value an extractor's schema rejects reads as `--since: Invalid date` rather than a raw schema dump. The `config` commands no longer report their own exits as failures, so `config get` of an unset key exits quietly with code 1. The `Error:` label is red, like the `✗`; the message stays plain.

A command in a hint prints without its backticks when there's color, plain against the dim hint so it stands out; plain output keeps the backticks. Hints name real examples rather than templates.

Hints are steps: one `↳` line each, a short instruction, and a command to run on its own line in cyan, whole. A command that doesn't exist (`chronicle sorces`) is reported the same way, suggesting the nearest one. `chronicle list`, an alias of `chronicle sources`, is gone.
