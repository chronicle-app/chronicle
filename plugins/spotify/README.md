# Chronicle Spotify Plugin

Extract listening history, saved tracks, and playlists from Spotify using OAuth authentication.

## Features

- **Recently Played**: Extract your recent listening history
- **Saved Tracks**: Extract your liked/saved tracks
- **Saved Albums**: Extract your saved/liked albums
- **Playlists**: Extract your playlists and their metadata
- **OAuth Authentication**: Secure authentication via Spotify OAuth 2.0

The API only remembers your last 50 plays. The `archive` strategy reads your
whole history, with your library, playlists, and searches, from the data you
download from Spotify:

```bash
chronicle extract spotify --input ~/Downloads/my_spotify_data.zip
```

## From a data download

Request your data on Spotify's [Privacy page](https://www.spotify.com/account/privacy).
Spotify sends each part you ask for as its own `my_spotify_data.zip`, and they
can take days to weeks to arrive. Two parts have records:

- **Extended streaming history**: every song and episode you've streamed since
  you joined, each with when it stopped and how long it played. These are the
  `listens`. Each download has your whole history, so you only need the newest.
- **Account data**: your library (`saved-tracks`, `saved-albums`,
  `saved-episodes`, `follows`), your playlists (`playlist-tracks`), and your
  searches (`searches`).

Pass either zip, its unzipped folder, or a folder that holds both. Older
downloads name the streaming history `endsong_0.json` and so on; those read
the same. `chronicle scan <path>` finds each part in a folder of exports.

With `--input`, a run reads `listens` unless you name other record types, or
use `-t all`:

```bash
chronicle extract spotify --input ~/Downloads/spotify
chronicle extract spotify --input ~/Downloads/spotify saved-tracks playlist-tracks
chronicle extract spotify --input ~/Downloads/spotify -t all --since 2024-01-01
```

Without `--input`, `chronicle extract spotify` still reads the API.

The download names each track's artist and album but gives them no Spotify
IDs. When you're signed in to Spotify (see [Setup](#setup)), a run looks each
track up in the Spotify API, 50 at a time, so its artists and album have their
IDs, as the API's own records do. Your whole history takes a while, about 15
minutes for 110,000 tracks. Pass `--no-lookup` to read the files alone, or
`--lookup` to stop with an error, rather than fall back to names, when you
aren't signed in. Listens, saved tracks, and playlist tracks are looked up;
saved albums, episodes, and podcasts aren't.

What a run leaves out:

- The account data's own year of streams (`StreamingHistory_music_0.json`):
  it names no track IDs, and the extended streaming history has every stream
  in it.
- Audiobooks, video streams, local files, and streams that didn't play at all.
- The IP address and user agent Spotify logs with each stream.
- The technical log information, which is the app's diagnostics.

## Setup

### 1. Create Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Note your **Client ID** and **Client Secret**
4. Add `http://127.0.0.1:7463/callback` to your app's redirect URIs (use 127.0.0.1 for Spotify's OAuth validation, port 7463 is Chronicle's default)

### 2. Authenticate

Run the OAuth flow to get an access token:

```bash
chronicle auth login spotify --client-id YOUR_CLIENT_ID --client-secret YOUR_CLIENT_SECRET
```

This will open your browser to authenticate with Spotify and store your access token.

### 3. Extract Data

Chronicle automatically uses your stored credentials and reads every record type unless you pass `--type`:

```bash
chronicle extract spotify
```

You can also manually provide a token:

```bash
chronicle extract spotify --access-token YOUR_ACCESS_TOKEN
```

## Credential Management

Chronicle stores your OAuth credentials in `~/.config/chronicle/credentials.json` for easy access. You can manage them with:

```bash
# Check stored credentials
chronicle auth list

# Check status of Spotify credentials
chronicle auth status spotify

# Remove stored credentials (requires re-authentication)
chronicle auth remove spotify
```

## Configuration Options

- `--access-token` (optional): OAuth access token (auto-retrieved from secure storage if not provided)
- `--limit` (default: 100): Limit the number of records extracted (use 0 for no limit)
- `--since` (optional): Extract records since this date
- `--until` (optional): Extract records until this date

## Example Usage

```bash
# Extract every record type
chronicle extract spotify

# Extract one record type
chronicle extract spotify --type listens

# Extract with limits and date ranges
chronicle extract spotify --limit 50
chronicle extract spotify --since 2024-01-01
chronicle extract spotify --until 2024-12-31

# Use a specific access token (overrides stored credentials)
chronicle extract spotify --access-token YOUR_TOKEN
```

## Data Types

The plugin extracts the following record types and transforms them into Chronicle actions:

- `listens` → `ListenAction`: Tracks you've recently listened to, at the second
  each stopped
- `like` → `LikeAction`: Tracks and albums you've saved/liked
- `playlist-tracks` → `AddAction`: Tracks added to the playlists in your
  library, a `Collection`, each by whoever added it: you, or for a playlist you
  follow or share, the person who did

From a data download:

- `listens` → `ListenAction` of a `MusicRecording` or `PodcastEpisode`, at the
  second the stream stopped. A listen is keyed by what played and that second,
  from the API or a download, so a play read both ways is one listen. How long
  a stream played isn't kept, since pauses make it no guide to when it began.
- `saved-tracks`, `saved-albums` → `LikeAction`, `saved-episodes` →
  `BookmarkAction`, `follows` → `FollowAction` of a `MusicGroup` or
  `PodcastSeries`. The library doesn't say when anything was added, so these
  have no timestamp and are as of the download.
- `playlist-tracks` → `AddAction` to the playlist, a `Collection`, on the day
  the item was added. A playlist has no ID in the download, so it's keyed by
  its name in the account.
- `searches` → `FindAction` of the `Query`

Tracks, saved albums, episodes, followed artists, and followed podcasts are
keyed by their Spotify IDs, with the same URLs the API gives them, so they're
the same nodes either way. A track looked up in the API is built as the API
builds it, with its artists and album by ID. Otherwise the download names a
track's artist and album, an episode's podcast, and a podcast's publisher
without IDs, so those are keyed by name, and a compilation's tracks, which it
gives Various Artists, the album's artist, have no artist of their own.

## Spotify API Scopes

The plugin requests these OAuth scopes:

- `user-read-recently-played`: Access recently played tracks
- `user-library-read`: Access saved tracks and albums
- `playlist-read-private`: Access private playlists
- `playlist-read-collaborative`: Access collaborative playlists

## Tests

The tests run each extractor and the transformer against synthetic Spotify API
responses served from a local HTTP server on 127.0.0.1, with a fake access token
passed in the config, and against a small synthetic data download, unzipped and
zipped, in a temporary directory. They never call Spotify, read stored
credentials, or read the host's data.
