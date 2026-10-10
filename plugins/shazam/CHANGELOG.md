# @chronicle.app/shazam

## 0.4.0

### Minor Changes

- a393051: A Shazam plugin extracts the songs you identified with Shazam from the library macOS keeps for Music Recognition, which syncs with the Shazam library in your iCloud account. Each Shazam is a `ListenAction` of the song, with where you were when the device knew. A song is Shazam's copy, keyed by its Shazam track key and named as Shazam names it, and `sameAs` its ISRC and its Apple Music song. `--link-artists` looks up each song's main artist on Apple Music and keys the artist by its Apple Music ID. `@chronicle.app/etl` adds `normalizeIsrc`, which writes an ISRC in its canonical form, and `ISRC_SOURCE`, the namespace a recording is `sameAs` by its ISRC.

### Patch Changes

- Updated dependencies [b0982a5]
- Updated dependencies [2148753]
- Updated dependencies [59904c0]
  - @chronicle.app/etl-sqlite@0.4.0
  - @chronicle.app/icloud@0.4.0
