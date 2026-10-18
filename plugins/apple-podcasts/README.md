# @chronicle.app/apple-podcasts

Chronicle plugin that imports podcast listening history from the local Apple
Podcasts app on macOS.

## Usage

### Basic extraction

The extractor defaults to the Apple Podcasts database in the app's group
container, so no `--input` is needed on a normal macOS install:

```sh
chronicle extract apple-podcasts
```

### With date filtering

```sh
chronicle extract apple-podcasts --since 2024-01-01 --until 2024-12-31 --limit 1000
```

## Configuration

The extractor supports the following options:

- `--input`: Path to the SQLite database file. Defaults to
  `~/Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite`.
- `--since`: Only episodes whose play state was last modified on or after this date.
- `--until`: Only episodes whose play state was last modified on or before this date.
- `--limit`: Maximum number of records to extract (omit or `0` for no limit).

## Source database

Apple Podcasts stores its library in a Core Data SQLite file
(`MTLibrary.sqlite`). The extractor reads these tables and emits two record types:

- `ZMTEPISODE` (`listens` records) — episodes the user engaged with: a non-zero
  play count, a playhead past the first few seconds, or a bookmark. Joined to its
  podcast via `ZPODCASTUUID`. Columns: `ZUUID`/`ZGUID`, `ZTITLE`, `ZAUTHOR`,
  `ZPLAYHEAD`, `ZPLAYCOUNT`, `ZLASTDATEPLAYED` / `ZLASTUSERMARKEDASPLAYEDDATE` /
  `ZPLAYSTATELASTMODIFIEDDATE` (listen time, best first), `ZPUBDATE`,
  `ZISBOOKMARKED`/`ZLASTBOOKMARKEDDATE`, `ZSTORETRACKID`,
  `ZWEBPAGEURL`/`ZARTWORKTEMPLATEURL`. Its duration and audio URL (`ZDURATION`,
  `ZREMOTEURL`) are on its current media enclosure, `ZMTMEDIAENCLOSURE` via
  `ZCURRENTMEDIAENCLOSURE`, and its description (`ZTEXT`, HTML converted to
  Markdown) is in `ZMTEPISODEDESCRIPTION` via `ZDESCRIPTIONOBJECT`. Its
  transcript, when the app has downloaded it, is a TTML file in the group
  container at `Library/Cache/Assets/TTML/<ZTRANSCRIPTIDENTIFIER>-<ZSTORETRACKID>.ttml`,
  where `ZTRANSCRIPTIDENTIFIER` is on the media enclosure.
- `ZMTPODCAST` (`subscription` records, where `ZSUBSCRIBED = 1`) — Columns:
  `ZUUID`, `ZTITLE`, `ZAUTHOR`, `ZCATEGORY`, `ZFEEDURL`, `ZIMAGEURL`,
  `ZWEBPAGEURL`, `ZSTORECOLLECTIONID`, `ZADDEDDATE`, `ZITEMDESCRIPTION`.

Core Data timestamps (seconds since 2001-01-01) are converted to Unix time.

This is a **snapshot** source: the database keeps only the latest state per row,
not a log of individual plays. Re-running re-reads the same rows with updated
state, so each action supersedes its prior value rather than accumulating
duplicates. Actions that carry a real historical date (listen, follow) keep that
date as their timeline position while being sighted at read time.

## Chronicle schema output

Entities:

- `PodcastEpisode` — title, description, `url` (web page), `duration` (ISO 8601), episode
  artwork as its `emblem`, the audio file in `contains` (`AudioObject`), plus a `sameAs` edge
  to the Apple catalog id (`ZSTORETRACKID`). Its `transcript` is the text of the
  downloaded TTML, a paragraph for each speaker's turn, without timings or
  speaker labels. The app keeps only some transcripts, mostly for episodes it
  has downloaded or just played, and clears them later; a transcript an earlier
  run extracted stays in the archive.
- `PodcastSeries` — title, description, `webFeed`, `genre`, artwork as its `emblem`, and a
  `sameAs` edge to the Apple catalog id (`ZSTORECOLLECTIONID`).
- `Person` — the macOS iCloud account (so listening merges onto the same identity
  as other iCloud-sourced data); `Organization` — show/episode authors as
  publishers.

Actions (all with the iCloud `Person` as `agent`; without an Apple Account
signed in, extraction stops):

- `ListenAction` — per played episode, timestamped at the real listen date.
- `CompleteAction` — when the episode was finished (a non-zero play count),
  closing the `consuming` interval the listen opened.
- `BookmarkAction` — per bookmarked episode.
- `FollowAction` — per subscribed show, dated when it was added to the library.

Not captured: the fractional playhead position (no schema field for partial
progress), the episode number, and the episode's release as an action.

`SHAPES.md` sketches the output, generated from the tests.
