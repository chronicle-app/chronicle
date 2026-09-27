---
'@chronicle.app/youtube': minor
'@chronicle.app/schema': minor
'@chronicle.app/cli': minor
---

Add the YouTube plugin, bundled with the CLI. It reads likes, subscriptions, playlists, and uploads from the YouTube Data API after `chronicle auth login youtube`, or watch and search history, comments, and the library from a Google Takeout folder with `--via takeout`. The vocabulary adds `AnnotateAction`, and `MediaObject` and `Collection` now sit under `CreativeWork`.
