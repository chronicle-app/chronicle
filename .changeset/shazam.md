---
'@chronicle.app/shazam': minor
'@chronicle.app/etl': minor
---

A Shazam plugin extracts the songs you identified with Shazam from the library macOS keeps for Music Recognition, which syncs with the Shazam library in your iCloud account. Each Shazam is a `ListenAction` of the song, with where you were when the device knew. A song is Shazam's copy, keyed by its Shazam track key and named as Shazam names it, and `sameAs` its ISRC and its Apple Music song. `--link-artists` looks up each song's main artist on Apple Music and keys the artist by its Apple Music ID. `@chronicle.app/etl` adds `normalizeIsrc`, which writes an ISRC in its canonical form, and `ISRC_SOURCE`, the namespace a recording is `sameAs` by its ISRC.
