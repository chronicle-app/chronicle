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
- `--since`: Only episodes last listened to, or saved, on or after this date.
- `--until`: Only episodes last listened to, or saved, on or before this date.
- `--limit`: Maximum number of records to extract (omit or `0` for no limit).

## Source database

Apple Podcasts stores its library in a Core Data SQLite file
(`MTLibrary.sqlite`). The extractor reads these tables and emits two record types:

- `ZMTEPISODE` (`listens` records) — episodes the user engaged with: a non-zero
  play count, a playhead past the first few seconds, or a bookmark. Joined to its
  podcast via `ZPODCASTUUID`. Columns: `ZGUID`, `ZTITLE`, `ZAUTHOR`,
  `ZPLAYHEAD`, `ZPLAYCOUNT`, `ZLASTDATEPLAYED` / `ZLASTUSERMARKEDASPLAYEDDATE` /
  `ZMTUPPMETADATA.ZTIMESTAMP` / `ZPLAYSTATELASTMODIFIEDDATE` (listen time, best
  first), `ZPUBDATE`, `ZISBOOKMARKED`/`ZLASTBOOKMARKEDDATE`, `ZSTORETRACKID`,
  `ZWEBPAGEURL`/`ZARTWORKTEMPLATEURL`, and the show's `ZSTORECOLLECTIONID`.
  `ZMTUPPMETADATA` is the playback-sync table, joined by `ZMETADATAIDENTIFIER`;
  its `ZTIMESTAMP` is when the episode's playback position last synced, and
  dates the many played episodes with no `ZLASTDATEPLAYED`.
  `ZPLAYSTATELASTMODIFIEDDATE` comes last because feed refreshes and
  library-wide updates change it too. Its duration and audio URL (`ZDURATION`,
  `ZREMOTEURL`) are on its current media enclosure, `ZMTMEDIAENCLOSURE` via
  `ZCURRENTMEDIAENCLOSURE`, and its description (`ZTEXT`, HTML converted to
  Markdown) is in `ZMTEPISODEDESCRIPTION` via `ZDESCRIPTIONOBJECT`. Its
  transcript, when the app has downloaded it, is a TTML file in the group
  container at `Library/Cache/Assets/TTML/<ZTRANSCRIPTIDENTIFIER>-<ZSTORETRACKID>.ttml`,
  where `ZTRANSCRIPTIDENTIFIER` is on the media enclosure.
- `ZMTPODCAST` (`subscription` records, where `ZSUBSCRIBED = 1`) — Columns:
  `ZTITLE`, `ZAUTHOR`, `ZCATEGORY`, `ZFEEDURL`, `ZIMAGEURL`,
  `ZWEBPAGEURL`, `ZSTORECOLLECTIONID`, `ZADDEDDATE`, `ZITEMDESCRIPTION`.
- `ZMTCHANNEL`, joined from a show by `ZCHANNEL` — the show's channel, its
  publisher's page on Apple Podcasts: `ZSTOREID` (its catalog ID) and `ZNAME`.
  Shows published independently have none.

Episodes and shows are keyed by Apple's catalog ID (`ZSTORETRACKID`,
`ZSTORECOLLECTIONID`, the ID in a podcasts.apple.com link), which is the same on
each device. The library's own UUIDs (`ZUUID`) differ from one device to the
next, so they aren't used. An episode or followed show that isn't in the catalog
has no key and is left out, and the run says how many.

A publisher that retires a show can retitle it and its episodes "Podcast no
longer available". That isn't a title, so they're left without a `name`, and a
title an earlier run extracted stays.

Core Data timestamps (seconds since 2001-01-01) are converted to Unix time.

This is a **snapshot** source: the database keeps only the latest state per row,
not a log of individual plays. Re-running re-reads the same rows with updated
state, so each action supersedes its prior value rather than accumulating
duplicates. Actions that carry a real historical date (listen, follow) keep that
date as their timeline position while being sighted at read time.

## Chronicle schema output

Entities:

- `PodcastEpisode` — keyed by its catalog ID; title, description, `url` (web
  page), `duration` (ISO 8601), when it was released as its `datePublished`
  (`ZPUBDATE`), episode artwork as its `emblem`, and the audio
  file in `contains` (`AudioObject`). Its `transcript` is the text of the
  downloaded TTML, a paragraph for each speaker's turn, without timings. Each
  paragraph starts with Apple's label for its speaker, such as `SPEAKER_1: `.
  The labels aren't names, and they're numbered within each episode. The app keeps only some transcripts, mostly for episodes it
  has downloaded or just played, and clears them later; a transcript an earlier
  run extracted stays in the archive.
- `PodcastSeries` — keyed by its catalog ID; title, description, `webFeed`,
  `genre`, artwork as its `emblem`, its `author`, and its channel as its
  `publisher`.
- `Person` — the macOS iCloud account (so listening merges onto the same identity
  as other iCloud-sourced data).
- `Agent` — the `author` the feed names for a show or an episode, keyed by that
  name. It can be a host, a network, or several people in one name, such as an
  episode's producers, so it isn't said to be a person or an organization.
- `Organization` — a show's channel on Apple Podcasts, as its `publisher`, keyed
  by the channel's catalog ID.

Actions (all with the iCloud `Person` as `agent`; without an Apple Account
signed in, extraction stops):

- `ListenAction` — per played episode, timestamped at the real listen date.
- `CompleteAction` — when the episode was finished (a non-zero play count),
  closing the `consuming` interval the listen opened.
- `BookmarkAction` — per bookmarked episode.
- `FollowAction` — per subscribed show, dated when it was added to the library.

Not captured: the fractional playhead position (no schema field for partial
progress) and the episode and season numbers.

`SHAPES.md` sketches the output, generated from the tests.
