---
'@chronicle.app/logging': patch
'@chronicle.app/etl': patch
'@chronicle.app/cli': patch
---

A failed record is named in its error, by its type and label, and the error no longer starts with "Extraction error:". A failed `--loader http` post gives its HTTP status, with the response body on the line below. With `--verbose`, each skipped record is named too, and the summary counts skips by type, such as "12 bookmarks skipped". When what a record became has no label, as with another system's payload, the record in progress is labeled by what was extracted.
