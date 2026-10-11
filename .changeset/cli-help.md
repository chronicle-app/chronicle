---
'@chronicle.app/cli': minor
---

Help is drawn like the rest of the CLI. `--help` and `chronicle help` show every screen (the root, `auth`, `config`, `config preset`, each command, the plugins' commands, and a source's own help) with the output module's styles: plain headings, no `$` prompt, flags written `--format <table|json|csv>` with `default: table`, and text in plain sentences. The root lists each command once, without the `e` alias, and `chronicle config` shows its commands instead of a hand-written list. Loader-only flags (`--indent`, `--flow-level`) no longer crowd `extract csv --help`.

`chronicle sources`, `sources info`, `plugins`, `auth list`, `auth status`, `config list`, and the `config preset` commands print with the output module's tables and cards: no `====` underlines, no emoji, dates to the minute. Hints under them go to stderr, and none points at a command that doesn't exist. `auth` calls what you sign in to a provider throughout.

Errors read alike: `auth status` and `auth remove` for a provider with nothing stored, an unknown `auth login` provider, an unknown preset, and an unset `config get` key each print `✗ Error:` with a hint, values in double quotes. `config reset` and `config preset delete` without a terminal say to use `--force` instead of crashing. A command passed as one quoted argument (`"auth list --help"`) is shown back with its words apart.
