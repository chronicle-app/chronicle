---
'@chronicle.app/goodreads': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the Goodreads plugin, bundled with the CLI. It reads a Goodreads library export CSV and emits a `BookmarkAction`, `CompleteAction`, or `ConsumeAction` on a `Book` for each shelved book. The vocabulary adds `Book`, `pageCount`, `publisher`, and `creator`.
