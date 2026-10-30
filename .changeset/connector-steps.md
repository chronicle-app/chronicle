---
'@chronicle.app/etl': patch
---

With `--verbose`, an extractor's "Initializing extraction" and "Teardown complete" lines name it, such as `connector=SafariBookmarksExtractor`, so a run that reads several kinds of one source says which extractor each line is about. JSON logs keep the name, since it isn't personal.
