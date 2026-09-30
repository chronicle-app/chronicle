---
'@chronicle.app/logging': minor
'@chronicle.app/etl': minor
'@chronicle.app/cli': minor
'@chronicle.app/auth': patch
'@chronicle.app/icloud': patch
'@chronicle.app/email': patch
'@chronicle.app/imessage': patch
'@chronicle.app/twitter': patch
---

Report extraction through output events. Everything a run says on stderr (progress, notices, record errors, the summary, and hints) is now an event rendered by one of three sinks, chosen with `--log-format pretty|plain|json`: pretty on a terminal, plain lines stamped with the time otherwise, and JSON lines for supervisors, with personal fields redacted unless `--log-personal` is set. A flood of the same record error shows three examples and a count. Plugin warnings now print when stdout is piped instead of being silenced. `@chronicle.app/logging` loggers emit events to a sink the host hands over (`Runner` takes `sink` and `run`), no longer set chalk's global color level, and drop the `theme` option. `TableLoader` moves from `@chronicle.app/etl` into the CLI; etl now exports `Rows`, `columnsOption`, and `LABELS`. Nothing in Chronicle writes to the console any more: every message goes through a logger, a host can redirect all of them with `setDefaultSink`, and during a run anything a plugin or dependency writes to the console becomes its diagnostics on the run's sink instead of reaching stdout. Without a known total, the live line shows a spinner and a count instead of a bar.
