# @chronicle.app/shazam

The songs you identified with Shazam, from the library macOS keeps for Music Recognition.

## Usage

```sh
chronicle extract shazam
chronicle extract shazam --since 2024-01-01 --until 2025-01-01
chronicle extract shazam --input "/path/to/ShazamLibrary.sqlite"
chronicle extract shazam --link-artists
```

The library is `~/Library/Application Support/com.apple.shazamd/ShazamLibrary.sqlite`, opened read-only with built-in `node:sqlite`. macOS keeps it in step with the Shazam library in your iCloud account, so it holds what you identified on every device: the Shazam app on your iPhone as well as Music Recognition in Control Center. It syncs only when Music Recognition is turned on in your iCloud settings. If the library is empty, open Music Recognition in Control Center to load your history.

Shazams come out newest first, and `--since` and `--until` bound when each song was identified.

A run reads only the library, offline. With `--link-artists`, it also looks up each song's main artist with Apple's public lookup API, which needs no sign-in: two requests for every 200 Shazams.

## Schema

| Shazam thing       | Chronicle node   | Key                                                             | Properties                                                                                                                                           |
| ------------------ | ---------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifying a song | `ListenAction`   | `@type`, `source`, `sourceId` (the recognition ID)              | `agent` (you), `object` (the song), `timestamp` (when it was identified), `location` (a `Location` with its `latitude` and `longitude`)              |
| The song           | `MusicRecording` | `@type`, `source` (`shazam`), `sourceId` (the Shazam track key) | `name`, `artist`, `inAlbum`, `duration`, `genre`, `datePublished` (the release date), `emblem` (the cover), `sameAs` (its ISRC and Apple Music song) |
| The artist         | `MusicGroup`     | `@type`, `source` (`apple-music`), `sourceId` (its artist ID)   | `name`, `url`; with `--link-artists`                                                                                                                 |
| The artist line    | `MusicGroup`     | `@type`, `source` (`shazam`), `name`                            | `name`; without `--link-artists`, or when Apple Music has no artist for the song                                                                     |
| The album          | `MusicAlbum`     | `@type`, `source` (`apple-music`), `sourceId` (its album ID)    | `name`                                                                                                                                               |
| You                | `Person`         | `@type`, `source` (`icloud`), `sourceId` (your account's DSID)  | `handle` (your Apple Account email); `sameAs` `@me`                                                                                                  |

`SHAPES.md` sketches the output, generated from the tests.

### Decisions

**Identifying a song is listening to it.** A Shazam is a `ListenAction` of the song, keyed by its recognition ID, which the Shazam app gives it on every device. A sync can leave two copies of one Shazam in the library; they're one action, from the most recently modified copy. A Shazam with no recognition ID is known by its sync ID. Shazaming a song again is another action with the same song.

**A song is Shazam's copy, the same song as its ISRC and Apple Music song.** The song is keyed by its Shazam track key and named as Shazam names it, with the artist line as Shazam words it (`Artist Feat. Guest`) unless its artist is linked. It's `sameAs` its ISRC, in the `isrc` namespace, which every service's copy of the recording shares, and its Apple Music song, in the `apple-music` namespace, with its link. The album, release date, duration, genres, and cover are Apple Music's, so a Shazam with no Apple Music match has none of them. The album is keyed by the album ID in the Apple Music link. Apple's root genre, `Music`, which every song has, is left out. Apple Music covers are stored as HEIC, which most browsers can't show, so the cover is the same size as a JPEG from Apple's image server. The plugin declares a `deepLinks` template for `MusicRecording` (`https://www.shazam.com/track/<key>`).

**An artist is Apple Music's when it's linked, and otherwise Shazam's artist line.** Shazam gives no artist ID, so without `--link-artists` the artist line is a `MusicGroup` keyed by its name. With it, the extractor looks up each song with Apple Music, a batch at a time, and the artist is a `MusicGroup` keyed by the Apple Music ID of the song's main artist, named as Apple Music names that artist. A song's lookup gives the main artist's ID beside the song's whole credit line (`Artist & Guest`), so the artist's own name (`Artist`) comes from a second lookup of the ID. Featured and other credited artists are left out. A Shazam with no Apple Music match keeps its artist line. Lookups are made in the store of the song's Apple Music link. When Apple Music limits lookups, the extractor waits and tries again; when it can't reach Apple Music, the rest of the run keeps artist lines and says so.

**Where you were, when the device knew.** A Shazam made without a location fix records 0, 0 or -180, -180, which is left out.

**The agent is your iCloud account,** whose library this is, from `@chronicle.app/icloud`. It's omitted when no account can be read. An explicit `account` object (or null) describes a copied library without a host account lookup.

**The archived fields are decoded in the plugin.** Core Data keeps a song's genres and Apple Music response as NSKeyedArchiver archives in binary property lists. `archive.ts` reads them. A field that doesn't decode is logged and left out; the Shazam is kept.

## Tests

The tests are smoke tests over a synthetic `ShazamLibrary.sqlite`, with archives written by the fixture, and pass an explicit iCloud account. They never read the host's Shazam library or iCloud account, and never reach Apple Music: `--link-artists`'s lookups aren't tested.
