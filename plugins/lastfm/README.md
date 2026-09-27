# @chronicle.app/lastfm

Chronicle plugin for Last.fm music listening history and loved tracks.

## Installation

```bash
npm install @chronicle.app/lastfm
```

## Authentication

The plugin supports multiple authentication methods:

### OAuth Session (Recommended)

1. Obtain a session key from Last.fm using their OAuth flow
2. Use the session key with the `--access-token` flag

### API Key

Use a traditional Last.fm API key with the `--api-key` flag

### Stored Credentials

The plugin automatically retrieves stored credentials from Chronicle's credential manager when available.

## Usage

### Extract recent listening history

```bash
# Short form (recommended)
chronicle extract lastfm --type listens --limit 500

# Full form (select the way in explicitly)
chronicle extract lastfm --via api --type listens --limit 500
```

### Extract friends

```bash
chronicle extract lastfm --type friends
```

### Extract loved tracks

```bash
chronicle extract lastfm --type loved-tracks --limit 100
```

### With API key authentication

```bash
chronicle extract lastfm --type listens \
  --api-key YOUR_API_KEY \
  --username your_lastfm_username \
  --since 2024-01-01 \
  --limit 1000
```

### With OAuth session key

```bash
chronicle extract lastfm --type loved-tracks \
  --access-token SESSION_KEY \
  --username your_lastfm_username
```

## Configuration

### Authentication Options

- `--access-token`: OAuth session key from Last.fm
- `--api-key`: Last.fm API key (alternative to OAuth)
- `--username`: Last.fm username (auto-retrieved from stored credentials when available)

### Extraction Options

- `--since`: Extract records from this date onwards (YYYY-MM-DD format)
- `--until`: Extract records up to this date (YYYY-MM-DD format)
- `--limit`: Maximum number of records to extract (default: 100)

### Output Options

- `--output`: Output file path
- `--loader`: Output format (json, csv, table, yaml)

## Commands

The extraction type is selected with `--type`; with no `--type`, every type is
read:

- `chronicle extract lastfm --type listens`: Recent listening history
- `chronicle extract lastfm --type loved-tracks`: Loved/favorited tracks
- `chronicle extract lastfm --type friends`: Friends (followed users)

List the available types with `chronicle extract lastfm --help`.

## Data Types

The plugin generates the following Chronicle schema types:

### Generated Chronicle Entities

- `ListenAction`: a scrobble (recent track), timestamped at the play time
- `LikeAction`: a loved/favorited track, timestamped when loved
- `FollowAction`: the listener following a friend; no timestamp (Last.fm gives no
  befriended date), sighted at read time by the snapshot `friends` extractor
- `CreateAction`: a friend's Last.fm account registration, keyed on the account
  handle and timestamped at their `registered` date (the account's
  coming-into-being on `result`)
- `Agent`: the listener and their friends, keyed on the Last.fm `handle` (the
  canonical username), with real name, profile URL, and avatar `image` when
  available
- `MusicRecording`: track details, with cover `image` when available
- `MusicAlbum`: album information (when available), with cover `image`
- `MusicGroup`: artist information, with artist `image` when available

Recordings, albums, and artists are deduplicated on their MusicBrainz ID when
present, otherwise on their Last.fm URL.

## API Integration

The plugin uses the following Last.fm API endpoints:

- `user.getRecentTracks`: Fetches listening history with automatic pagination
- `user.getLovedTracks`: Fetches loved tracks with automatic pagination
- `user.getFriends`: Fetches friends (followed users) with automatic pagination
- `user.getinfo`: Retrieves user profile information

### Features

- Automatic pagination for large datasets
- Rate limiting (200ms delay between requests)
- Filters out "now playing" tracks and invalid timestamps
- MusicBrainz ID-based deduplication when available
- Date range filtering support

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Run the tests
npm test
```

The tests serve synthetic Last.fm API responses from a local HTTP server on
127.0.0.1, pass fake credentials as config, and point the credential store at an
empty temporary directory, so they never call Last.fm or read the host's stored
credentials or accounts.
