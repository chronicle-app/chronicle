# @chronicle.app/marvin

Chronicle plugin for reading sessions and annotations from Marvin, the e-reader app.
It reads the CSV files Marvin exports. Pass the file with `--input` and pick the
record type with `--type`:

```sh
chronicle extract marvin --type reading-sessions --input sessions.csv
chronicle extract marvin --type annotations --input annotations.csv
```

Each type reads its own export file. The reading-sessions export has one row per
part of a session (`Session ID`, `Book Title`, `Book Author`, `Date Created`,
`Part Time` in seconds). Rows are grouped by session: part times are summed and the
latest `Date Created` ends the session. Each session becomes a `ReadAction` whose
`startTime` is the end time minus the total part time, with the `Book` as its
`object`. Sessions come out oldest first. The limit also caps the CSV rows read
before grouping, so pass `--limit 0` to read a whole export.

The annotations export has one row per highlight or note (`ID`, `Title`, `Author`,
`Date` or `Created`, `HighlightText`, `EntryText`). A highlight becomes a
`QuoteAction` whose `result` is a `Quotation` that is part of the `Book`. A note
becomes an `AnnotateAction` whose `result` is a `Comment` about the highlight, or
about the book when the row has no highlight. Rows with neither are skipped.

Books have no IDs in the export, so a `Book` is keyed by its title and its author's
name. Marvin escapes commas in author names as `\,`; they are unescaped. The export
does not identify the reader, so the agent is the `marvin` self person, marked as
you with `sameAs: ['@me']`.

Tests use small synthetic CSV files with made-up books and quotes, and never read
the host's data or accounts.
