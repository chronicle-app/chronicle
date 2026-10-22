---
'@chronicle.app/cli': minor
'@chronicle.app/etl': minor
'@chronicle.app/etl-sqlite': minor
'@chronicle.app/apple-call-history': minor
'@chronicle.app/apple-notes': minor
'@chronicle.app/apple-podcasts': minor
'@chronicle.app/apple-voice-memos': minor
'@chronicle.app/apple-wallet': minor
'@chronicle.app/arc-timeline': minor
'@chronicle.app/chrome': minor
'@chronicle.app/claude-code': minor
'@chronicle.app/foodnoms': minor
'@chronicle.app/imessage': minor
'@chronicle.app/moves-app': minor
'@chronicle.app/obsidian': minor
'@chronicle.app/safari': minor
'@chronicle.app/shazam': minor
'@chronicle.app/shell': minor
'@chronicle.app/things-todo': minor
'@chronicle.app/timing-app': minor
'@chronicle.app/whatsapp': minor
'@chronicle.app/zotero': minor
---

`chronicle survey` counts what each source on this computer holds, and over which years, without extracting it. It surveys every source `chronicle sources scan` finds ready, all at once, and fills in a table as each answers. `chronicle survey <source>` shows one source's records by year, and takes the options `extract` does, so `chronicle survey moves-app --input ~/moves_export` counts an export before you extract it. `--type`, `--since`, and `--until` count what a run with them would extract, and `--format json` or `csv` gives the counts as data.

An extractor says how much a run would read with `survey()`. For each record type it gives a count, the first and last times, totals worth showing beside the count, like Chrome's pages or iMessage's conversations and attachment bytes, and, when asked, the records in each month. It's measured as cheaply as the source allows, with aggregate queries or file dates, and only a source with no other way to count reads every record. `@chronicle.app/etl-sqlite` adds `monthSql` and `countsByMonth` to count records by month in a query. Apple Call History, Apple Notes, Apple Podcasts, Voice Memos, Apple Wallet, Arc Timeline, Chrome, Claude Code, FoodNoms, iMessage, Moves, Obsidian, Safari, Shazam, the shell history, Things, Timing, WhatsApp, and Zotero each survey what they hold.
