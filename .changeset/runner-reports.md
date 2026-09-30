---
'@chronicle.app/etl': minor
'@chronicle.app/logging': minor
'@chronicle.app/cli': patch
---

The `Runner` reports its own run: `progress` as it reads, processes, and writes records, a keyed `error` event for each failed record operation, and a `summary` with the run's totals once a completed run is torn down. A host that drives the `Runner` directly, such as a server running ETL, gets the same events the CLI shows without re-implementing the counting. `runner.stats` holds the totals, `title` and `output` label the run, `Extractor.recordLimit()` exposes an extractor's limit, and `@chronicle.app/logging` exports the `ProgressFields` and `SummaryFields` shapes. The CLI's output is unchanged.
