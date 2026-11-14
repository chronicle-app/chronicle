# @chronicle.app/letterboxd

The films you watched, rated, reviewed, liked, and saved to your watchlist, from
the Letterboxd data export.

## Installation

```bash
npm install @chronicle.app/letterboxd
```

## Usage

Export your data from [Settings → Data](https://letterboxd.com/settings/data/),
then pass the zip or its unpacked folder:

```bash
chronicle extract letterboxd --input letterboxd-pat-2026-03-01-10-30-utc.zip
```

One record type at a time:

```bash
chronicle extract letterboxd watches --input <export> --since 2025-01-01
```

## Configuration

- `--input` (required): The Letterboxd export, as a zip or its unpacked folder
- `--film-pages`: Fetch each film's page from Letterboxd for its link and its
  IMDb and TMDB ids
- `--film-cache`: The file fetched film pages are kept in. The default is
  `~/.cache/chronicle/letterboxd/films.json`.
- `--since`, `--until`, `--limit`: The usual window and cap

## Record types

| Record type | From                                                        | Becomes                                         |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------- |
| `watches`   | `diary.csv`, and films in `watched.csv` with no diary entry | `WatchAction` on a `Movie`                      |
| `ratings`   | `ratings.csv`, and ratings given on diary entries           | `RespondAction` whose `Response` has the rating |
| `reviews`   | `reviews.csv`                                               | `RespondAction` whose `Comment` is the review   |
| `watchlist` | `watchlist.csv`                                             | `BookmarkAction` on a `Movie`                   |
| `likes`     | `likes/films.csv`, `likes/reviews.csv`                      | `LikeAction` on a `Movie` or a `Comment`        |

[SHAPES.md](SHAPES.md) shows each in full.

Letterboxd gives days, not times, so a `timestamp` is a civil date such as
`2025-06-01`.

### Watches

A diary entry is one viewing, on its `Watched Date`, with its tags as `tags`.
Watching a film again is another entry and another `WatchAction`.

A film in `watched.csv` with no diary entry was seen on a day the export doesn't
give: the date in that file is when you marked it. It becomes a `WatchAction`
with no `timestamp`.

### Ratings and reviews

A rating is a number out of five, in half stars: `ratingValue: 3.5` with
`bestRating: 5`.

`ratings.csv` has each film's rating as it stands now. A diary entry has the
rating you gave on that day, which can differ. Both are kept: one
`RespondAction` per rated diary entry, and one per film for its current rating.
A review carries the rating given with it, so a reviewed entry has no separate
rating.

### Not read

The `Rewatch` flag, `comments.csv`, `likes/lists.csv`, the `deleted` and
`orphaned` folders, and the join date and other profile fields.

## Identity

Letterboxd's short links hold its ids. `https://boxd.it/1TzQ` is film `1TzQ`,
and `https://boxd.it/2Vy6mz` is diary entry `2Vy6mz`.

| Node                                                                      | Key                               |
| ------------------------------------------------------------------------- | --------------------------------- |
| `Movie`                                                                   | the film's code                   |
| A viewing, and a rating or review given on it                             | the diary entry's code            |
| A film's current rating, a like, a watchlist entry, a film marked watched | your username and the film's code |
| You                                                                       | your username, from `profile.csv` |

A short link is a redirect, not the page's address, so it is never a `url`. A
film has a `url` only when its page has been fetched.

`diary.csv` and `reviews.csv` give the entry's link and not the film's, so a row
finds its film by name and year among the films the other files name. When two
of your films share a name and a year, the row's film is keyed on that name and
year instead, as a film of its own. `--film-pages` resolves these by following
the entry's link.

## Film pages

With `--film-pages`, each film's page is fetched once, a few a second, and kept
in the cache file. A film then has:

- `url`: its address, such as `https://letterboxd.com/film/small-soldiers/`
- `sameAs`: its IMDb id (`tt0122718`) and its TMDB id (`movie/11551`), each in
  its own namespace, so it is the same film another source names by either

Pages already kept are used on every run, with or without the flag, so a later
run without it doesn't drop them. A film's key is its code either way.

## Tests

Tests write a small synthetic export to a temp directory and answer its page
requests themselves, so they never read the host's Letterboxd data or reach
Letterboxd.
