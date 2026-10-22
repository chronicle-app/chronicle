---
'@chronicle.app/cli': minor
'@chronicle.app/etl': minor
'@chronicle.app/chrome': minor
'@chronicle.app/github': minor
'@chronicle.app/obsidian': minor
'@chronicle.app/apple-call-history': patch
'@chronicle.app/apple-notes': patch
'@chronicle.app/apple-podcasts': patch
'@chronicle.app/apple-voice-memos': patch
'@chronicle.app/apple-wallet': patch
'@chronicle.app/arc-timeline': patch
'@chronicle.app/claude-code': patch
'@chronicle.app/foodnoms': patch
'@chronicle.app/imessage': patch
'@chronicle.app/safari': patch
'@chronicle.app/shazam': patch
'@chronicle.app/shell': patch
'@chronicle.app/things-todo': patch
'@chronicle.app/timing-app': patch
'@chronicle.app/whatsapp': patch
'@chronicle.app/zotero': patch
---

`chronicle sources scan` finds the sources on this computer and says whether each is ready to extract, with the command that extracts it. `chronicle sources scan chrome` looks for one source, and `--format json` or `csv` lists every row with its command. It opens what it finds to check it can be read, reads none of it, and stays off the network. A row macOS blocks says it needs Full Disk Access, and a source whose plugin isn't installed says which plugin to install.

A plugin's manifest says where each strategy's files are, as `locations` under the strategy: a path in the home folder, with `*` for any name within one folder and `{option}` for a name that is also the run's option, like Chrome's `{profile}`. A plugin can export a `Locator` from `@chronicle.app/etl` to name what a location matched, or to find what no path can. Chrome names each profile as its profile menu does, with the account it's signed in to. Obsidian lists each vault it has opened, and GitHub finds the credential a run would use without asking GitHub whether it still works.
